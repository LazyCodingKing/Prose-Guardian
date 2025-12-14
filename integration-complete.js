/**
 * COMPLETE INTEGRATION: Modules A + B + C
 * The full "Client-Side Fix + Proactive Injection" architecture
 */

import StaticFixer from './static-fixer.js';
import PassiveWatcher from './passive-watcher.js';
import ProactiveInjector from './proactive-injector.js';
import { eventSource, event_types, getContext } from '../../../../script.js';

// ============================================================================
// EXAMPLE 1: Complete Integration in AI-SlopFixer
// ============================================================================

class SloDFixerCoreEngine {
    constructor() {
        this.initialized = false;
        this.stats = {
            messagesProcessed: 0,
            staticFixesApplied: 0,
            phrasesDetected: 0,
            injectionsPerformed: 0
        };
    }

    async initialize() {
        console.log('[SlopFixer] Initializing 3-module architecture...');

        // MODULE A: Load static replacement rules
        await StaticFixer.loadRules('scripts/extensions/third-party/AI-SlopFixer/regex-rules.json');
        console.log('[SlopFixer] Module A ready:', StaticFixer.getStats());

        // MODULE B: Configure passive watcher
        PassiveWatcher.settings.slopThreshold = 5.0;
        PassiveWatcher.settings.messagesToAnalyze = 20;
        console.log('[SlopFixer] Module B ready');

        // MODULE C: Configure proactive injector
        ProactiveInjector.setEnabled(true);
        ProactiveInjector.setInjectionMode('system');
        console.log('[SlopFixer] Module C ready');

        // Analyze existing chat history
        const context = getContext();
        if (context.chat && context.chat.length > 0) {
            const results = PassiveWatcher.analyzeChatHistory(context.chat);
            ProactiveInjector.updateOverusedPhrases(results.overusedPhrases);
            console.log('[SlopFixer] Initial analysis complete:', results);
        }

        this.initialized = true;
        console.log('[SlopFixer] ✓ All modules initialized');
    }

    /**
     * Main processing pipeline - called for every new message
     */
    async processMessage(messageId) {
        if (!this.initialized) {
            console.warn('[SlopFixer] Not initialized yet');
            return;
        }

        const context = getContext();
        const message = context.chat[messageId];

        if (!message || message.is_user) return;

        let currentText = message.mes;
        const startTime = performance.now();

        // === PHASE 1: STATIC FIXER (Module A) ===
        // Instant, zero-token fixes
        const staticResult = StaticFixer.process(currentText);
        if (staticResult !== currentText) {
            currentText = staticResult;
            this.stats.staticFixesApplied++;
            console.log('[SlopFixer] Applied static fixes');
        }

        // === PHASE 2: PASSIVE WATCHER (Module B) ===
        // Background analysis for future prevention
        PassiveWatcher.analyzeMessage(currentText);
        this.stats.phrasesDetected = PassiveWatcher.slopCandidates.size;

        // Update Module C every 5 messages
        if (PassiveWatcher.totalMessagesProcessed % 5 === 0) {
            const overused = PassiveWatcher.getOverusedPhrases();
            if (overused.length > 0) {
                ProactiveInjector.updateOverusedPhrases(overused);
                console.log(`[SlopFixer] Updated proactive injector with ${overused.length} phrases`);
            }
        }

        // === PHASE 3: UPDATE MESSAGE ===
        if (currentText !== message.mes) {
            message.mes = currentText;
            updateMessageBlock(messageId, message);
        }

        const endTime = performance.now();
        this.stats.messagesProcessed++;
        console.log(`[SlopFixer] Processed in ${(endTime - startTime).toFixed(2)}ms`);
    }

    /**
     * Hook into generation - inject preventative instructions
     */
    async beforeGeneration() {
        if (!this.initialized) return;

        const context = getContext();
        const overused = PassiveWatcher.getOverusedPhrases();

        if (overused.length > 0) {
            ProactiveInjector.updateOverusedPhrases(overused);

            // Inject anti-slop directive
            const success = await ProactiveInjector.injectInstructions(context);

            if (success) {
                this.stats.injectionsPerformed++;
                console.log('[SlopFixer] ✓ Proactive injection added to generation');
            }
        }
    }

    /**
     * Get comprehensive statistics
     */
    getStats() {
        return {
            core: this.stats,
            moduleA: StaticFixer.getStats(),
            moduleB: PassiveWatcher.getStats(),
            moduleC: ProactiveInjector.getStats()
        };
    }
}

// Global instance
const slopFixerEngine = new SlopFixerCoreEngine();

// ============================================================================
// EXAMPLE 2: Event Hooks Integration
// ============================================================================

async function setupEventHooks() {
    // Initialize on app ready
    eventSource.on(event_types.APP_READY, async () => {
        await slopFixerEngine.initialize();
    });

    // Process every new message
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
        slopFixerEngine.processMessage(messageId);
    });

    // Inject before generation
    eventSource.on(event_types.GENERATION_STARTED, async () => {
        await slopFixerEngine.beforeGeneration();
    });

    // Reset on chat change
    eventSource.on(event_types.CHAT_CHANGED, () => {
        PassiveWatcher.reset();
        ProactiveInjector.reset();
        console.log('[SlopFixer] Reset for new chat');

        // Re-analyze new chat
        setTimeout(async () => {
            const context = getContext();
            if (context.chat && context.chat.length > 0) {
                const results = PassiveWatcher.analyzeChatHistory(context.chat);
                ProactiveInjector.updateOverusedPhrases(results.overusedPhrases);
            }
        }, 1000);
    });
}

// ============================================================================
// EXAMPLE 3: Settings Integration
// ============================================================================

const SLOP_FIXER_SETTINGS = {
    // Module A: Static Fixer
    staticFixerEnabled: true,
    staticRulesPath: 'scripts/extensions/third-party/AI-SlopFixer/regex-rules.json',

    // Module B: Passive Watcher
    passiveWatcherEnabled: true,
    slopThreshold: 5.0,
    messagesToAnalyze: 20,
    ngramMax: 7,

    // Module C: Proactive Injector
    proactiveInjectorEnabled: true,
    injectionMode: 'system',
    maxPhrasesToInject: 10,
    injectionPriority: 'high',

    // General
    showStatistics: true,
    debugMode: false
};

function applySettings(settings) {
    // Module A
    StaticFixer.enabled = settings.staticFixerEnabled;

    // Module B
    PassiveWatcher.enabled = settings.passiveWatcherEnabled;
    PassiveWatcher.settings.slopThreshold = settings.slopThreshold;
    PassiveWatcher.settings.messagesToAnalyze = settings.messagesToAnalyze;
    PassiveWatcher.settings.ngramMax = settings.ngramMax;

    // Module C
    ProactiveInjector.setEnabled(settings.proactiveInjectorEnabled);
    ProactiveInjector.setInjectionMode(settings.injectionMode);
    ProactiveInjector.setPriority(settings.injectionPriority);

    console.log('[SlopFixer] Settings applied');
}

// ============================================================================
// EXAMPLE 4: UI Display - Live Statistics Dashboard
// ============================================================================

function updateStatisticsDashboard() {
    const stats = slopFixerEngine.getStats();

    // Update DOM
    document.getElementById('asf_messages_processed').textContent = stats.core.messagesProcessed;
    document.getElementById('asf_static_fixes').textContent = stats.core.staticFixesApplied;
    document.getElementById('asf_phrases_detected').textContent = stats.core.phrasesDetected;
    document.getElementById('asf_injections').textContent = stats.core.injectionsPerformed;

    // Module A stats
    document.getElementById('asf_static_rules_active').textContent =
        `${stats.moduleA.enabled}/${stats.moduleA.total}`;

    // Module B stats
    document.getElementById('asf_slop_candidates').textContent = stats.moduleB.slopCandidates;

    // Module C stats
    updateOverusedPhrasesList(stats.moduleC.topPhrases);
}

function updateOverusedPhrasesList(phrases) {
    const container = document.getElementById('asf_overused_phrases');

    if (!phrases || phrases.length === 0) {
        container.innerHTML = '<p class="dim">No overused phrases detected yet</p>';
        return;
    }

    const html = phrases.map(item => `
        <div class="phrase-item">
            <span class="phrase">"${item.phrase}"</span>
            <span class="badge">×${item.count}</span>
            <span class="score">${item.score.toFixed(1)}</span>
        </div>
    `).join('');

    container.innerHTML = html;
}

// Add to settings.html:
/*
<div class="asf-dashboard">
    <h3>📊 Real-Time Statistics</h3>
    
    <div class="stats-grid">
        <div class="stat-card">
            <span class="stat-label">Messages Processed</span>
            <span id="asf_messages_processed" class="stat-value">0</span>
        </div>
        
        <div class="stat-card">
            <span class="stat-label">Static Fixes Applied</span>
            <span id="asf_static_fixes" class="stat-value">0</span>
        </div>
        
        <div class="stat-card">
            <span class="stat-label">Phrases Detected</span>
            <span id="asf_phrases_detected" class="stat-value">0</span>
        </div>
        
        <div class="stat-card">
            <span class="stat-label">Injections Performed</span>
            <span id="asf_injections" class="stat-value">0</span>
        </div>
    </div>
    
    <h4>⚠️ Currently Overused Phrases</h4>
    <div id="asf_overused_phrases" class="overused-list"></div>
</div>
*/

// ============================================================================
// EXAMPLE 5: Manual Controls
// ============================================================================

// Analyze current chat on demand
async function analyzeCurrentChat() {
    const context = getContext();
    const results = PassiveWatcher.analyzeChatHistory(context.chat);

    ProactiveInjector.updateOverusedPhrases(results.overusedPhrases);
    updateStatisticsDashboard();

    window.toastr.success(`Analyzed ${results.analyzed} messages, found ${results.overusedPhrases.length} overused phrases`);
}

// Force injection for next generation
async function forceProactiveInjection() {
    const context = getContext();
    const success = await ProactiveInjector.injectInstructions(context);

    if (success) {
        window.toastr.success('Anti-slop directive injected for next generation');
    } else {
        window.toastr.error('Injection failed');
    }
}

// Reset all modules
function resetAllModules() {
    PassiveWatcher.reset();
    ProactiveInjector.reset();
    slopFixerEngine.stats = {
        messagesProcessed: 0,
        staticFixesApplied: 0,
        phrasesDetected: 0,
        injectionsPerformed: 0
    };
    updateStatisticsDashboard();
    window.toastr.info('All modules reset');
}

// ============================================================================
// EXAMPLE 6: Performance Monitoring
// ============================================================================

function runPerformanceBenchmark() {
    console.log('=== AI-SlopFixer Performance Benchmark ===');

    const testMessage = `His heart pounded in his chest. Her eyes widened in surprise. 
    His pulse quickened as her cheeks flushed red. They stood there, hearts racing.`;

    // Benchmark Module A (Static Fixer)
    const iterations = 1000;
    let start = performance.now();
    for (let i = 0; i < iterations; i++) {
        StaticFixer.process(testMessage);
    }
    let end = performance.now();
    console.log(`Module A: ${((end - start) / iterations).toFixed(3)}ms per message`);

    // Benchmark Module B (Passive Watcher)
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
        PassiveWatcher.analyzeMessage(testMessage);
    }
    end = performance.now();
    console.log(`Module B: ${((end - start) / iterations).toFixed(3)}ms per message`);

    // Total pipeline
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
        const fixed = StaticFixer.process(testMessage);
        PassiveWatcher.analyzeMessage(fixed);
    }
    end = performance.now();
    console.log(`Complete pipeline: ${((end - start) / iterations).toFixed(3)}ms per message`);

    console.log('=== Benchmark Complete ===');
}

// ============================================================================
// EXAMPLE 7: Export Integration Points
// ============================================================================

export {
    slopFixerEngine,
    setupEventHooks,
    applySettings,
    updateStatisticsDashboard,
    analyzeCurrentChat,
    forceProactiveInjection,
    resetAllModules,
    runPerformanceBenchmark
};

// ============================================================================
// EXAMPLE 8: Quick Start Guide
// ============================================================================

/*
QUICK START:

1. Add to your index.js initialization:
   ```javascript
   import { slopFixerEngine, setupEventHooks } from './integration-complete.js';
   
   jQuery(async () => {
       await slopFixerEngine.initialize();
       setupEventHooks();
   });
   ```

2. Add UI controls to settings.html (see Example 4)

3. That's it! The system will:
   - Apply instant fixes to every message (Module A)
   - Track overused patterns in background (Module B)
   - Inject prevention instructions automatically (Module C)

EXPECTED PERFORMANCE:
- Static Fixer: < 5ms per message
- Passive Watcher: < 2ms per message
- Total overhead: < 10ms per message (negligible)
- API calls: ZERO (except for Quality Mode rewrites)

WORKFLOW:
User sends message → AI responds → 
→ Module A fixes immediately → 
→ Module B analyzes in background → 
→ Module C injects prevention for NEXT generation

Result: "Generate → Fail → Rewrite" becomes "Prevent → Success"
*/
