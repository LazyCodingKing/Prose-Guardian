/**
 * MODULE B INTEGRATION EXAMPLES
 * How to use Passive Watcher in AI-SlopFixer
 */

import PassiveWatcher from './passive-watcher.js';

// ============================================================================
// EXAMPLE 1: Basic Usage (Main Thread)
// ============================================================================

// Initialize and analyze recent messages
async function setupPassiveWatcher() {
    const context = getContext();
    const chat = context.chat;

    // Analyze last 20 AI messages
    const results = PassiveWatcher.analyzeChatHistory(chat);

    console.log('Analysis Results:', results);
    console.log('Overused Phrases:', results.overusedPhrases);

    // Example output:
    // {
    //   phrase: "his heart pounded",
    //   score: 12.3,
    //   count: 4
    // }
}

// ============================================================================
// EXAMPLE 2: Real-time Analysis (Hook into message flow)
// ============================================================================

// In your index.js, add this to the message event handler:
eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
    const context = getContext();
    const message = context.chat[messageId];

    if (!message.is_user && message.mes) {
        // Analyze new AI message
        PassiveWatcher.analyzeMessage(message.mes);

        // Log stats every 10 messages
        if (PassiveWatcher.totalMessagesProcessed % 10 === 0) {
            console.log('[PassiveWatcher] Stats:', PassiveWatcher.getStats());
        }
    }
});

// ============================================================================
// EXAMPLE 3: Web Worker Usage (Recommended for large chats)
// ============================================================================

class PassiveWatcherManager {
    constructor() {
        this.worker = null;
        this.ready = false;
    }

    async init(settings = {}) {
        return new Promise((resolve, reject) => {
            this.worker = new Worker('scripts/extensions/third-party/AI-SlopFixer/passive-watcher.worker.js');

            this.worker.onmessage = (e) => {
                const { type, data, results, phrases, stats, error } = e.data;

                switch (type) {
                    case 'ready':
                        this.ready = true;
                        resolve();
                        break;

                    case 'batchComplete':
                        console.log('[Worker] Batch analysis complete:', results);
                        break;

                    case 'overusedPhrases':
                        console.log('[Worker] Overused phrases:', phrases);
                        // Trigger Module C injection here
                        this.triggerProactiveInjection(phrases);
                        break;

                    case 'error':
                        console.error('[Worker] Error:', error);
                        reject(error);
                        break;
                }
            };

            this.worker.onerror = (error) => {
                console.error('[Worker] Fatal error:', error);
                reject(error);
            };

            // Initialize worker
            this.worker.postMessage({
                type: 'init',
                data: { settings }
            });
        });
    }

    analyzeBatch(messages) {
        if (!this.ready) {
            console.warn('[Worker] Not ready yet');
            return;
        }

        this.worker.postMessage({
            type: 'analyzeBatch',
            data: { messages }
        });
    }

    getOverusedPhrases(minScore = 5.0) {
        if (!this.ready) return;

        this.worker.postMessage({
            type: 'getOverusedPhrases',
            data: { minScore }
        });
    }

    triggerProactiveInjection(phrases) {
        // This is the bridge to Module C
        if (phrases.length > 0) {
            console.log('[PassiveWatcher] Detected overused phrases, triggering proactive injection');
            // Will be implemented in Module C
        }
    }

    reset() {
        if (this.ready) {
            this.worker.postMessage({ type: 'reset' });
        }
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.ready = false;
        }
    }
}

// Usage:
const watcherManager = new PassiveWatcherManager();
await watcherManager.init({ slopThreshold: 5.0, messagesToAnalyze: 20 });
watcherManager.analyzeBatch(context.chat);

// ============================================================================
// EXAMPLE 4: UI Integration - Display Overused Phrases
// ============================================================================

function updateOverusedPhrasesUI() {
    const overused = PassiveWatcher.getOverusedPhrases();
    const container = document.getElementById('asf_overused_phrases_list');

    if (!container) return;

    if (overused.length === 0) {
        container.innerHTML = '<p class="dim">No overused phrases detected yet.</p>';
        return;
    }

    const html = overused.slice(0, 10).map(item => `
        <div class="overused-phrase-item">
            <span class="phrase">"${item.phrase}"</span>
            <span class="stats">Used ${item.count}× (score: ${item.score.toFixed(1)})</span>
        </div>
    `).join('');

    container.innerHTML = html;
}

// Add to settings.html:
/*
<h4>📊 Overused Phrases</h4>
<div id="asf_overused_phrases_list" style="max-height: 200px; overflow-y: auto;">
    <p class="dim">No analysis run yet</p>
</div>
<button id="asf_analyze_chat" class="menu_button">
    <i class="fa-solid fa-search"></i> Analyze Chat History
</button>
*/

// ============================================================================
// EXAMPLE 5: Combine with Module A (Static Fixer)
// ============================================================================

async function processMessageWithBothModules(messageId) {
    const context = getContext();
    const message = context.chat[messageId];

    if (message.is_user) return;

    let currentText = message.mes;

    // MODULE A: Static Fixer (instant)
    if (settings.fastModeEnabled) {
        currentText = StaticFixer.process(currentText);
    }

    // MODULE B: Passive Watcher (background analysis)
    PassiveWatcher.analyzeMessage(currentText);

    // Check if we should trigger Module C
    const overused = PassiveWatcher.getOverusedPhrases();
    if (overused.length > 3) {
        console.log('[AI-SlopFixer] Detected repetitive patterns, consider enabling proactive injection');
        // This will trigger Module C in the next generation
    }

    // Update message
    if (currentText !== message.mes) {
        message.mes = currentText;
        updateMessageBlock(messageId, message);
    }
}

// ============================================================================
// EXAMPLE 6: Auto-Reset on New Chat
// ============================================================================

eventSource.on(event_types.CHAT_CHANGED, () => {
    console.log('[PassiveWatcher] Chat changed, resetting analysis');
    PassiveWatcher.reset();

    // Re-analyze new chat after a delay
    setTimeout(() => {
        const context = getContext();
        if (context.chat && context.chat.length > 0) {
            PassiveWatcher.analyzeChatHistory(context.chat);
        }
    }, 1000);
});

// ============================================================================
// EXAMPLE 7: Performance Monitoring
// ============================================================================

function benchmarkPassiveWatcher() {
    const testMessages = [
        { mes: "His heart pounded in his chest. His heart pounded again.", is_user: false },
        { mes: "Her cheeks flushed red. Her cheeks flushed crimson.", is_user: false },
        { mes: "His heart pounded once more. The rhythm was fast.", is_user: false },
        // ... more test messages
    ];

    const start = performance.now();

    testMessages.forEach(msg => {
        PassiveWatcher.analyzeMessage(msg.mes);
    });

    const end = performance.now();
    const avgTime = (end - start) / testMessages.length;

    console.log(`Average analysis time: ${avgTime.toFixed(3)}ms per message`);
    console.log('Stats:', PassiveWatcher.getStats());

    // Expected: < 2ms per message (much faster than API calls)
}

// ============================================================================
// EXAMPLE 8: Custom Whitelist
// ============================================================================

function setupCustomWhitelist() {
    // Add character-specific words to ignore
    PassiveWatcher.addToWhitelist([
        'character_name',
        'location_name',
        'special_term',
        // Add custom words that shouldn't be flagged as slop
    ]);
}

// ============================================================================
// Export for use in main extension
// ============================================================================

export {
    setupPassiveWatcher,
    PassiveWatcherManager,
    updateOverusedPhrasesUI,
    processMessageWithBothModules,
    benchmarkPassiveWatcher,
    setupCustomWhitelist
};
