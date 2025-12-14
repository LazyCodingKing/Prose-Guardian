/**
 * USAGE EXAMPLE: How to integrate Static Fixer into AI-SlopFixer
 */

import StaticFixer from './static-fixer.js';

// ============================================================================
// INTEGRATION EXAMPLE 1: Basic Setup
// ============================================================================

async function setupStaticFixer() {
    // Load rules from the regex_rules.json file
    await StaticFixer.loadRules('scripts/extensions/third-party/AI-SlopFixer/regex-rules.json');

    // Or load inline rules
    const inlineRules = [
        {
            "id": "STATIC_001",
            "scriptName": "Slopfix - Heart Pounding",
            "findRegex": "\\b([Hh]is|[Hh]er|[Tt]heir|[Mm]y|[Yy]our)\\s+heart\\s+(pounded|hammered|thudded|fluttered)\\b",
            "replaceString": "{{random:a frantic rhythm drummed against $1 ribs,$1 pulse hammered at the base of $1 throat,$1 chest tightened with a heavy thudding}}",
            "disabled": false,
            "isStatic": true
        }
    ];
    await StaticFixer.loadRules(inlineRules);

    console.log('Static Fixer ready!', StaticFixer.getStats());
}

// ============================================================================
// INTEGRATION EXAMPLE 2: Process Message
// ============================================================================

function processMessageText(rawText) {
    // Apply static replacements
    const cleaned = StaticFixer.process(rawText);
    return cleaned;
}

// ============================================================================
// INTEGRATION EXAMPLE 3: Hook into SillyTavern's message flow
// ============================================================================

// In your AI-SlopFixer index.js, add this to processMessage():

async function processMessage(messageId, forceManual = false) {
    const context = getContext();
    const message = context.chat[messageId];

    if (!message || message.is_user) return;

    let currentText = message.mes;

    // === MODULE A: STATIC FIXER (Instant, Zero-Token) ===
    if (settings.fastModeEnabled) {
        const staticResult = StaticFixer.process(currentText);
        if (staticResult !== currentText) {
            currentText = staticResult;
            console.log('[AI-SlopFixer] Static fixes applied');
        }
    }

    // === Continue with your existing Quality Mode logic ===
    if (settings.qualityModeEnabled) {
        // AI rewrite logic here...
    }

    // Update message
    if (currentText !== message.mes) {
        message.mes = currentText;
        updateMessageBlock(messageId, message);
    }
}

// ============================================================================
// INTEGRATION EXAMPLE 4: Rule Management UI
// ============================================================================

function updateRuleManagerUI() {
    const stats = StaticFixer.getStats();
    document.getElementById('asf_static_rule_count').textContent =
        `${stats.enabled}/${stats.total} rules active`;

    // List rules by category
    Object.entries(stats.categories).forEach(([category, count]) => {
        console.log(`${category}: ${count} rules`);
    });
}

// Toggle specific rule
function toggleRule(ruleId, enabled) {
    StaticFixer.setRuleEnabled(ruleId, enabled);
    saveSettings();
}

// ============================================================================
// INTEGRATION EXAMPLE 5: Performance Testing
// ============================================================================

function benchmarkStaticFixer() {
    const testText = `His heart pounded in his chest. Her cheeks flushed red. 
    Their eyes widened in surprise. He smiled warmly at her.`;

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
        StaticFixer.process(testText);
    }

    const end = performance.now();
    const avgTime = (end - start) / iterations;

    console.log(`Average processing time: ${avgTime.toFixed(3)}ms per message`);
    // Expected: < 5ms per message
}

// ============================================================================
// INTEGRATION EXAMPLE 6: Settings Panel Addition
// ============================================================================

// Add to your settings.html:
/*
<h4>⚡ Static Fixer (Module A)</h4>
<label class="checkbox_label" for="asf_static_fixer_enabled">
    <input type="checkbox" id="asf_static_fixer_enabled" checked />
    <span>Enable Static Fixer</span>
</label>
<small>Instant regex-based slop removal (zero API calls)</small>

<div id="asf_static_stats" style="margin: 10px 0;">
    <strong>Active Rules:</strong> <span id="asf_static_rule_count">0/0</span>
</div>

<button id="asf_manage_static_rules" class="menu_button">
    <i class="fa-solid fa-list"></i> Manage Static Rules
</button>
*/

// ============================================================================
// INTEGRATION EXAMPLE 7: Migration from existing Fast Mode
// ============================================================================

// Convert your existing slop-patterns.json to the new format:
async function migrateExistingPatterns() {
    const oldPatterns = await fetch('slop-patterns.json').then(r => r.json());

    const newRules = oldPatterns.map((pattern, index) => ({
        id: `MIGRATED_${index.toString().padStart(3, '0')}`,
        scriptName: pattern.name || `Pattern ${index + 1}`,
        findRegex: pattern.regex,
        replaceString: '{{random:' + pattern.replacements.join(',') + '}}',
        disabled: false,
        isStatic: true,
        category: pattern.category || 'Migrated'
    }));

    await StaticFixer.loadRules(newRules);
    console.log(`Migrated ${newRules.length} patterns to Static Fixer`);
}

// ============================================================================
// Export for use in main extension
// ============================================================================

export {
    setupStaticFixer,
    processMessageText,
    updateRuleManagerUI,
    toggleRule,
    benchmarkStaticFixer,
    migrateExistingPatterns
};
