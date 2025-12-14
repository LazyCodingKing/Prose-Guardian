/**
 * MODULE B: Passive Watcher (Background N-Gram Analysis)
 * Ported from ProsePolisher for AI-SlopFixer
 * 
 * Detects repetitive writing patterns without API calls using Web Workers
 * for off-main-thread processing.
 */

// common-words.js - List of words to ignore during analysis
export const COMMON_WORDS = new Set([
    'the', 'of', 'to', 'and', 'a', 'in', 'is', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'with', 'as', 'I',
    'his', 'they', 'be', 'at', 'one', 'have', 'this', 'from', 'or', 'had', 'by', 'not', 'word', 'but', 'what', 'some',
    'we', 'can', 'out', 'other', 'were', 'all', 'there', 'when', 'up', 'use', 'your', 'how', 'said', 'an', 'each',
    'she', 'which', 'do', 'their', 'time', 'if', 'will', 'way', 'about', 'many', 'then', 'them', 'write', 'would',
    'like', 'so', 'these', 'her', 'long', 'make', 'thing', 'see', 'him', 'two', 'has', 'look', 'more', 'day', 'could',
    'go', 'come', 'did', 'number', 'sound', 'no', 'most', 'people', 'my', 'over', 'know', 'water', 'than', 'call',
    // ... (truncated for brevity - full list in source)
]);

export class PassiveWatcher {
    constructor(options = {}) {
        this.settings = {
            ngramMin: 3,
            ngramMax: 7,
            slopThreshold: 5.0,
            pruningCycle: 20,
            patternMinCommon: 2,
            messagesToAnalyze: options.analysisWindow || 20, // Customizable!
            ...options
        };

        this.ngramFrequencies = new Map();
        this.slopCandidates = new Set();
        this.totalMessagesProcessed = 0;
        this.enabled = true;

        // Whitelist = common words to ignore
        this.whitelist = new Set([...COMMON_WORDS]);
    }

    /**
     * Strip HTML/markdown markup from text
     * @param {String} text - Raw text
     * @returns {String} - Clean text
     */
    stripMarkup(text) {
        if (!text) return '';

        let clean = text;

        // Remove code blocks
        clean = clean.replace(/(?:```|~~~)\w*\s*[\s\S]*?(?:```|~~~)/g, ' ');

        // Remove HTML tags
        clean = clean.replace(/<[^>]*>/g, ' ');

        // Remove markdown formatting
        clean = clean.replace(/(?:\*|_|~|`)+(.+?)(?:\*|_|~|`)+/g, '$1');

        // Remove quotes and parentheses content
        clean = clean.replace(/"(.*?)"/g, ' $1 ');
        clean = clean.replace(/\((.*?)\)/g, ' $1 ');

        // Normalize whitespace
        clean = clean.replace(/\s+/g, ' ').trim();

        return clean;
    }

    /**
     * Generate n-grams from word array
     * @param {Array} words - Array of words
     * @param {Number} n - N-gram size
     * @returns {Array} - Array of n-grams
     */
    generateNgrams(words, n) {
        const ngrams = [];
        if (words.length < n) return ngrams;

        for (let i = 0; i <= words.length - n; i++) {
            ngrams.push(words.slice(i, i + n).join(' '));
        }

        return ngrams;
    }

    /**
     * Check if phrase is low quality (all common words)
     * @param {String} phrase - Phrase to check
     * @returns {Boolean} - True if low quality
     */
    isPhraseLowQuality(phrase) {
        const words = phrase.toLowerCase().split(' ');

        if (words.length < this.settings.ngramMin) return true;

        // If all words are common, ignore this phrase
        const allCommon = words.every(word => this.whitelist.has(word));
        if (allCommon) return true;

        return false;
    }

    /**
     * Analyze a single message and track phrase frequency
     * @param {String} text - Message text
     */
    analyzeMessage(text) {
        if (!text || !this.enabled) return;

        const cleanText = this.stripMarkup(text);
        if (!cleanText.trim()) return;

        // Split into sentences
        const sentences = cleanText.match(/[^.!?]+[.!?]+["]?/g) || [cleanText];

        for (const sentence of sentences) {
            if (!sentence.trim()) continue;

            // Tokenize: remove punctuation, lowercase, split
            const words = sentence
                .replace(/[.,!?]/g, '')
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean);

            // Generate n-grams from 3 to 7 words
            for (let n = this.settings.ngramMin; n <= this.settings.ngramMax; n++) {
                if (words.length < n) continue;

                const ngrams = this.generateNgrams(words, n);

                for (const ngram of ngrams) {
                    // Skip if low quality
                    if (this.isPhraseLowQuality(ngram)) continue;

                    // Track frequency
                    const currentData = this.ngramFrequencies.get(ngram) || {
                        count: 0,
                        score: 0,
                        lastSeen: this.totalMessagesProcessed
                    };

                    // Calculate score increment
                    let scoreIncrement = 1.0;

                    // Bonus for longer phrases
                    scoreIncrement += (n - this.settings.ngramMin) * 0.2;

                    // Bonus for uncommon words
                    const uncommonWordCount = ngram.split(' ').reduce((count, word) => {
                        return count + (this.whitelist.has(word) ? 0 : 1);
                    }, 0);
                    scoreIncrement += uncommonWordCount * 0.5;

                    const newCount = currentData.count + 1;
                    const newScore = currentData.score + scoreIncrement;

                    this.ngramFrequencies.set(ngram, {
                        count: newCount,
                        score: newScore,
                        lastSeen: this.totalMessagesProcessed
                    });

                    // Add to slop candidates if threshold reached
                    if (newScore >= this.settings.slopThreshold &&
                        currentData.score < this.settings.slopThreshold) {
                        this.slopCandidates.add(ngram);
                    }
                }
            }
        }

        this.totalMessagesProcessed++;

        // Periodic pruning
        if (this.totalMessagesProcessed % this.settings.pruningCycle === 0) {
            this.pruneOldNgrams();
        }
    }

    /**
     * Prune old/low-score n-grams
     */
    pruneOldNgrams() {
        let prunedCount = 0;

        for (const [ngram, data] of this.ngramFrequencies.entries()) {
            const age = this.totalMessagesProcessed - data.lastSeen;

            if (age > this.settings.pruningCycle) {
                if (data.score < this.settings.slopThreshold) {
                    this.ngramFrequencies.delete(ngram);
                    this.slopCandidates.delete(ngram);
                    prunedCount++;
                } else {
                    // Decay score for old phrases
                    data.score *= 0.9;
                }
            }
        }

        if (prunedCount > 0) {
            console.log(`[PassiveWatcher] Pruned ${prunedCount} old n-grams`);
        }
    }

    /**
     * Get overused phrases (for Module C injection)
     * @param {Number} minScore - Minimum score threshold
     * @returns {Array} - Array of {phrase, score, count}
     */
    getOverusedPhrases(minScore = 5.0) {
        const overused = [];

        for (const [phrase, data] of this.ngramFrequencies.entries()) {
            if (data.score >= minScore) {
                overused.push({
                    phrase,
                    score: data.score,
                    count: data.count
                });
            }
        }

        // Sort by score descending
        overused.sort((a, b) => b.score - a.score);

        return overused;
    }

    /**
     * Get statistics about tracked phrases
     * @returns {Object} - Statistics object
     */
    getStats() {
        return {
            totalPhrases: this.ngramFrequencies.size,
            slopCandidates: this.slopCandidates.size,
            messagesProcessed: this.totalMessagesProcessed,
            topPhrases: this.getOverusedPhrases().slice(0, 10)
        };
    }

    /**
     * Reset all tracking data
     */
    reset() {
        this.ngramFrequencies.clear();
        this.slopCandidates.clear();
        this.totalMessagesProcessed = 0;
    }

    /**
     * Add words to whitelist
     * @param {Array} words - Words to ignore
     */
    addToWhitelist(words) {
        words.forEach(word => this.whitelist.add(word.toLowerCase()));
    }

    /**
     * Update analysis window size
     * @param {Number} windowSize - Number of messages to analyze
     */
    setAnalysisWindow(windowSize) {
        this.settings.messagesToAnalyze = windowSize;
        console.log(`[PassiveWatcher] Analysis window updated to ${windowSize} messages`);
    }

    /**
     * Analyze chat history (batch processing)
     * @param {Array} messages - Array of message objects
     * @returns {Object} - Analysis results
     */
    analyzeChatHistory(messages) {
        this.reset();

        const aiMessages = messages.filter(msg => !msg.is_user && msg.mes);

        // Take last N messages (customizable)
        const recentMessages = aiMessages.slice(-this.settings.messagesToAnalyze);

        recentMessages.forEach(msg => {
            this.analyzeMessage(msg.mes);
        });

        return {
            analyzed: recentMessages.length,
            overusedPhrases: this.getOverusedPhrases(),
            stats: this.getStats()
        };
    }
}

// Export default instance
export default new PassiveWatcher();
