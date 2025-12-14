/**
 * MODULE C: Proactive Injector (Preventative Prompting)
 * Simplified from ProsePolisher's Project Gremlin for AI-SlopFixer
 * 
 * Modifies the system prompt dynamically to prevent bad writing habits
 * before they happen, using data from Module B (Passive Watcher).
 */

export class ProactiveInjector {
    constructor() {
        this.enabled = true;
        this.overusedPhrases = [];
        this.injectionMode = 'system'; // 'system', 'user', or 'both'
        this.priority = 'high'; // 'high', 'medium', 'low'
    }

    /**
     * Update the list of overused phrases from Module B
     * @param {Array} phrases - Array of {phrase, score, count}
     */
    updateOverusedPhrases(phrases) {
        this.overusedPhrases = phrases;
        console.log(`[ProactiveInjector] Tracking ${phrases.length} overused phrases`);
    }

    /**
     * Generate preventative instructions based on overused phrases
     * @param {Number} maxPhrases - Maximum phrases to include
     * @returns {String} - Instruction text
     */
    generatePreventativeInstructions(maxPhrases = 10) {
        if (!this.enabled || this.overusedPhrases.length === 0) {
            return '';
        }

        const topPhrases = this.overusedPhrases
            .slice(0, maxPhrases)
            .map(item => `"${item.phrase}"`);

        if (topPhrases.length === 0) return '';

        const instruction = `
[ANTI-SLOP DIRECTIVE - HIGH PRIORITY]
The following phrases have been severely overused in recent responses. You MUST avoid them completely:

${topPhrases.join(', ')}

Instead, use fresh, creative alternatives that convey the same meaning through different words, metaphors, or descriptive angles. Show emotions and reactions through unique sensory details, body language, and dialogue rather than these clichéd patterns.
`.trim();

        return instruction;
    }

    /**
     * Generate context-aware alternatives suggestion
     * @returns {String} - Suggestion text
     */
    generateAlternativesSuggestion() {
        if (!this.enabled || this.overusedPhrases.length === 0) {
            return '';
        }

        const examples = this.overusedPhrases.slice(0, 3).map(item => {
            const phrase = item.phrase;
            return `- Instead of "${phrase}", consider: physical sensations, environmental details, or internal monologue`;
        }).join('\n');

        const suggestion = `
[WRITING GUIDELINE]
Recent patterns to avoid:
${examples}

Focus on vivid, specific, and varied descriptions that haven't appeared in the last 20 messages.
`.trim();

        return suggestion;
    }

    /**
     * Inject instructions into the generation context
     * This is the main integration point with AI-SlopFixer
     * @param {Object} context - SillyTavern context
     * @returns {Object} - Modified context or injection string
     */
    async injectInstructions(context) {
        if (!this.enabled || this.overusedPhrases.length === 0) {
            console.log('[ProactiveInjector] No phrases to inject');
            return null;
        }

        const instructions = this.generatePreventativeInstructions();

        console.log('[ProactiveInjector] Injecting anti-slop directive:', instructions.substring(0, 100) + '...');

        // Use SillyTavern's chat injection system
        // This will be executed before generation
        const injectionScript = `/inject ${JSON.stringify(instructions)} position=1 depth=0`;

        try {
            await context.executeSlashCommandsWithOptions(injectionScript, {
                showOutput: false,
                handleExecutionErrors: true
            });
            console.log('[ProactiveInjector] Injection successful');
            return true;
        } catch (error) {
            console.error('[ProactiveInjector] Injection failed:', error);
            return false;
        }
    }

    /**
     * Simpler injection method: Return instruction text for manual injection
     * @returns {String} - Instruction text to inject
     */
    getInjectionText() {
        if (!this.enabled || this.overusedPhrases.length === 0) {
            return null;
        }

        return this.generatePreventativeInstructions();
    }

    /**
     * Create a "light touch" version - less aggressive
     * @returns {String} - Gentle reminder text
     */
    generateGentleReminder() {
        if (!this.enabled || this.overusedPhrases.length === 0) {
            return '';
        }

        const topPhrases = this.overusedPhrases
            .slice(0, 5)
            .map(item => item.phrase);

        const reminder = `[OOC: Focus on fresh, varied descriptions. Recent overused patterns include: ${topPhrases.join(', ')}. Find creative alternatives.]`;

        return reminder;
    }

    /**
     * Clear the overused phrases list
     */
    reset() {
        this.overusedPhrases = [];
        console.log('[ProactiveInjector] Reset - cleared overused phrases');
    }

    /**
     * Get statistics about current injection state
     * @returns {Object} - Stats
     */
    getStats() {
        return {
            enabled: this.enabled,
            phrasesTracked: this.overusedPhrases.length,
            injectionMode: this.injectionMode,
            priority: this.priority,
            wouldInject: this.overusedPhrases.length > 0,
            topPhrases: this.overusedPhrases.slice(0, 5)
        };
    }

    /**
     * Enable/disable injection
     * @param {Boolean} enabled 
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`[ProactiveInjector] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Set injection mode
     * @param {String} mode - 'system', 'user', or 'both'
     */
    setInjectionMode(mode) {
        if (['system', 'user', 'both'].includes(mode)) {
            this.injectionMode = mode;
            console.log(`[ProactiveInjector] Injection mode: ${mode}`);
        }
    }

    /**
     * Set priority level
     * @param {String} priority - 'high', 'medium', or 'low'
     */
    setPriority(priority) {
        if (['high', 'medium', 'low'].includes(priority)) {
            this.priority = priority;
        }
    }

    /**
     * Generate blacklist for regex generation
     * This creates a format compatible with ProsePolisher's blacklist
     * @returns {Object} - Blacklist object
     */
    generateBlacklist() {
        const blacklist = {};

        this.overusedPhrases.forEach(item => {
            // Convert score to weight (higher score = higher weight)
            const weight = Math.min(10, Math.ceil(item.score / 2));
            blacklist[item.phrase] = weight;
        });

        return blacklist;
    }

    /**
     * Create Module A (Static Fixer) compatible rules from overused phrases
     * This allows automatic creation of replacement rules
     * @returns {Array} - Array of rule objects
     */
    generateStaticRules() {
        const rules = [];

        this.overusedPhrases.slice(0, 10).forEach((item, index) => {
            const words = item.phrase.split(' ');

            // Create a regex pattern with pronoun capture groups
            let pattern = words.map(word => {
                // Check if word is a pronoun
                const pronouns = ['his', 'her', 'their', 'my', 'your', 'he', 'she', 'they', 'i', 'you'];
                if (pronouns.includes(word.toLowerCase())) {
                    return `([Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Yy]our)`;
                }
                return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape special chars
            }).join('\\s+');

            pattern = `\\b${pattern}\\b`;

            rules.push({
                id: `PROACTIVE_${index.toString().padStart(3, '0')}`,
                scriptName: `Auto-generated - Overused: ${item.phrase}`,
                findRegex: pattern,
                replaceString: '{{random:REPLACEMENT_NEEDED}}', // Placeholder
                disabled: false,
                isStatic: true,
                category: 'Auto-Generated',
                source: 'ProactiveInjector',
                note: `Created from phrase detected ${item.count} times with score ${item.score.toFixed(1)}`
            });
        });

        return rules;
    }
}

// Export default instance
export default new ProactiveInjector();
