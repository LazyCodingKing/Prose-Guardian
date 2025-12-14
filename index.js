/**
 * AI Slop Fixer - SillyTavern Extension
 * Dual-mode slop detection and fixing: Fast (regex) + Quality (AI rewrite)
 */

import { eventSource, event_types, saveSettingsDebounced, saveChatConditional, generateQuietPrompt, messageFormatting, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, updateMessageBlock } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { ConnectionManagerRequestService } from '../../shared.js';

// CRITICAL: Import optimized modules (Prose Polisher logic)
import StaticFixer from './static-fixer.js';
import PassiveWatcher from './passive-watcher.js';
import ProactiveInjector from './proactive-injector.js';

const EXTENSION_NAME = 'Prose-Guardian';
const LOG_PREFIX = `[${EXTENSION_NAME}]`;

// Default settings
const defaultSettings = {
    // Fast Mode
    fastModeEnabled: true,

    // Quality Mode
    qualityModeEnabled: true,
    qualityModeInterval: 5,
    qualityModeManualOnly: false,

    // Connection Profile
    connectionProfile: '', // Empty = use main chat connection

    // Constraints
    minWords: 50,
    maxWords: 500,
    minParagraphs: 1,
    maxParagraphs: 10,
    minDialogues: 0,
    maxDialogues: 999,

    // User Protection
    protectUser: true,
    userNames: ['{{user}}'],

    // Perspective
    perspective: '3rd', // '1st', '2nd', or '3rd'

    // Formatting & Immersion
    enableVisualEffects: false,
    separateDialogue: true,

    // Presets
    presets: [],
    current_preset: '',

    // Learning Mode
    learningEnabled: false,
    autoApplyLearned: true,
    learnThreshold: 3, // Auto-generate rule after N occurrences
    maxLearnedRules: 100,

    // Guided Response Settings
    guidedResponsePrompt: '{{input}}',
    guidedResponseDepth: 0,
    reviewBeforeAdding: false,

    // Prompt Injection (Prevention Mode)
    enablePromptInjection: true,
    promptInjectionPosition: 'system',  // 'system', 'after_scenario', 'before_user'
    preventionInstructions: `Write naturally and avoid these common AI writing patterns:
- Repetitive phrases like "her heart raced", "breath hitched", "eyes widened"
- Overused emotional beats and physical reactions  
- Purple prose and excessive metaphors
- Predictable dialogue patterns
Keep your writing fresh, varied, and human.`,

    // UI/UX Settings
    autoMode: true,  // Auto-apply changes without user approval
    showNotifications: false,  // Show notifications in extension settings only

    // Debug
    debugMode: false,

    // Learned Rules (global, stored here)
    learnedRules: []
};

let settings = { ...defaultSettings };
let messageCount = 0;
let isAppReady = false;

// Diagnostic state
const MAX_HISTORY = 20; // Keep last 20 runs
let diagnosticsHistory = []; // Array of diagnostic objects

// Current run diagnostic (temp storage during processing)
let currentDiagnostic = {
    originalText: '',
    rewrittenText: '',
    tokenCount: 0,
    debugLogs: [],
    timestamp: null,
    modesUsed: []
};

function addDebugLog(message) {
    if (!settings.debugMode) return;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    currentDiagnostic.debugLogs.push(logEntry);
    console.log(`${LOG_PREFIX} ${logEntry}`);
}

function saveDiagnosticToHistory() {
    // Add to beginning of array
    diagnosticsHistory.unshift({ ...currentDiagnostic });

    // Keep only last MAX_HISTORY entries
    if (diagnosticsHistory.length > MAX_HISTORY) {
        diagnosticsHistory = diagnosticsHistory.slice(0, MAX_HISTORY);
    }

    // Reset current for next run
    currentDiagnostic = {
        originalText: '',
        rewrittenText: '',
        tokenCount: 0,
        debugLogs: [],
        timestamp: null,
        modesUsed: []
    };
}

// -----------------------------------------------------------------------------
// PROMPT INJECTION (Prevention Mode)
// -----------------------------------------------------------------------------

function injectAntiSlopPrompt() {
    if (!settings.enablePromptInjection || !settings.preventionInstructions.trim()) {
        return;
    }

    // Build dynamic instructions from learned rules
    let instructions = settings.preventionInstructions;

    if (settings.learningEnabled && settings.learnedRules.length > 0 && settings.autoApplyLearned) {
        const learnedPatterns = settings.learnedRules
            .slice(0, 10) // Top 10 most common
            .map(rule => `- "${rule.pattern}"`)
            .join('\n');

        if (learnedPatterns) {
            instructions += `\n\nAdditionally avoid these detected patterns:\n${learnedPatterns}`;
        }
    }

    // Determine prompt type and position
    let promptType;
    switch (settings.promptInjectionPosition) {
        case 'system':
            promptType = extension_prompt_types.IN_PROMPT;
            break;
        case 'after_scenario':
            promptType = extension_prompt_types.AFTER_SCENARIO;
            break;
        case 'before_user':
            promptType = extension_prompt_types.IN_CHAT;
            break;
        default:
            promptType = extension_prompt_types.IN_PROMPT;
    }

    setExtensionPrompt(
        EXTENSION_NAME,
        instructions,
        promptType,
        0, // Priority
        extension_prompt_roles.SYSTEM
    );

    addDebugLog(`Injected anti-slop prompt (${settings.promptInjectionPosition})`);
}

function removeAntiSlopPrompt() {
    if (!settings.enablePromptInjection) {
        return;
    }

    setExtensionPrompt(EXTENSION_NAME, '', 0, 0);
    addDebugLog('Removed anti-slop prompt');
}

// -----------------------------------------------------------------------------
// NOTIFICATIONS & STATUS (Extension Settings Only)
// -----------------------------------------------------------------------------

function showNotification(message, type = 'info') {
    if (!settings.showNotifications) return;

    // Only show in extension settings area, not main chat
    const $status = $('#asf_status_message');
    if ($status.length) {
        $status
            .text(message)
            .removeClass('info success warning error')
            .addClass(type)
            .fadeIn()
            .delay(3000)
            .fadeOut();
    }
}

// -----------------------------------------------------------------------------
// DIFF UI (Visual Before/After Comparison)
// -----------------------------------------------------------------------------

/**
 * Show diff popup for user approval
 * @param {string} originalText - Original text
 * @param {string} newText - Rewritten text
 * @returns {Promise<boolean>} - True if accepted, false if rejected
 */
async function showDiffPopup(originalText, newText) {
    return new Promise((resolve) => {
        const diff = computeLineDiff(originalText, newText);

        const modalHtml = `
            <div id="asf_diff_backdrop" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 9998; display: flex; align-items: center; justify-content: center;">
                <div id="asf_diff_modal" style="background: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 10px; max-width: 90vw; max-height: 90vh; width: 1000px; display: flex; flex-direction: column; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
                    <div style="padding: 20px; border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: var(--SmartThemeEmColor);">AI Slop Fixer - Review Changes</h3>
                        <button class="asf-diff-close" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--SmartThemeEmColor);">&times;</button>
                    </div>
                    <div style="padding: 20px; overflow-y: auto; flex: 1;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div>
                                <h4 style="color: var(--SmartThemeEmColor); margin-top: 0;">Original</h4>
                                <div class="asf-diff-panel" style="background: var(--black10alpha); padding: 15px; border-radius: 5px; min-height: 200px; font-family: monospace; white-space: pre-wrap; word-wrap: break-word;">
                                    ${escapeHtml(originalText)}
                                </div>
                            </div>
                            <div>
                                <h4 style="color: var(--SmartThemeEmColor); margin-top: 0;">Fixed</h4>
                                <div class="asf-diff-panel" style="background: var(--black10alpha); padding: 15px; border-radius: 5px; min-height: 200px; font-family: monospace; white-space: pre-wrap; word-wrap: break-word;">
                                    ${renderDiffLines(diff)}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div style="padding: 20px; border-top: 1px solid var(--SmartThemeBorderColor); display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="menu_button asf-diff-reject" style="background: var(--SmartThemeQuoteColor);">❌ Reject Changes</button>
                        <button class="menu_button asf-diff-accept" style="background: var(--SmartThemeBlurTintColor);">✅ Accept Changes</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        const cleanup = (result) => {
            $('#asf_diff_backdrop').fadeOut(200, function () {
                $(this).remove();
            });
            resolve(result);
        };

        $('#asf_diff_backdrop .asf-diff-accept').on('click', () => cleanup(true));
        $('#asf_diff_backdrop .asf-diff-reject').on('click', () => cleanup(false));
        $('#asf_diff_backdrop .asf-diff-close').on('click', () => cleanup(false));
        $('#asf_diff_backdrop').on('click', function (e) {
            if (e.target === this) cleanup(false);
        });
    });
}

/**
 * Compute line-based diff using simple LCS algorithm
 * @param {string} originalText
 * @param {string} newText
 * @returns {Array} Array of {type, line} objects
 */
function computeLineDiff(originalText, newText) {
    const oldLines = originalText.split('\n');
    const newLines = newText.split('\n');
    const result = [];

    // Simple diff - just mark all new lines as changed for now
    // This is a simplified version; a full LCS implementation would be more complex
    newLines.forEach((line, i) => {
        if (i < oldLines.length && line === oldLines[i]) {
            result.push({ type: 'unchanged', line });
        } else {
            result.push({ type: 'changed', line });
        }
    });

    return result;
}

/**
 * Render diff lines with color coding
 * @param {Array} diff - Array of diff objects
 * @returns {string} HTML string
 */
function renderDiffLines(diff) {
    return diff.map(item => {
        let bgColor = '';
        if (item.type === 'changed') {
            bgColor = 'background: rgba(76, 175, 80, 0.2);'; // Green tint
        }
        return `<div style="${bgColor}">${escapeHtml(item.line)}</div>`;
    }).join('');
}

// QUALITY MODE - Detect violations
function detectViolations(text) {
    const violations = [];

    // Word count
    const words = text.trim().split(/\s+/).filter(w => w);
    const wordCount = words.length;
    if (wordCount < settings.minWords) {
        violations.push({
            type: 'word_count',
            description: `Too short (${wordCount} words, minimum ${settings.minWords})`
        });
    }
    if (wordCount > settings.maxWords) {
        violations.push({
            type: 'word_count',
            description: `Too long (${wordCount} words, maximum ${settings.maxWords})`
        });
    }

    // Paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
    const paraCount = paragraphs.length;
    if (paraCount < settings.minParagraphs) {
        violations.push({
            type: 'paragraphs',
            description: `Too few paragraphs (${paraCount}, minimum ${settings.minParagraphs})`
        });
    }
    if (paraCount > settings.maxParagraphs) {
        violations.push({
            type: 'paragraphs',
            description: `Too many paragraphs (${paraCount}, maximum ${settings.maxParagraphs})`
        });
    }

    // Dialogues
    const dialogues = text.match(/"[^"]+"/g) || [];
    const dialogueCount = dialogues.length;
    if (dialogueCount < settings.minDialogues) {
        violations.push({
            type: 'dialogues',
            description: `Too few dialogue lines (${dialogueCount}, minimum ${settings.minDialogues})`
        });
    }
    if (settings.maxDialogues < 999 && dialogueCount > settings.maxDialogues) {
        violations.push({
            type: 'dialogues',
            description: `Too many dialogue lines (${dialogueCount}, maximum ${settings.maxDialogues})`
        });
    }

    // User character protection
    const userMentions = detectUserControl(text);
    if (userMentions) {
        violations.push({
            type: 'user_control',
            description: userMentions // Already a string now
        });
    }

    // Perspective check
    const detectedPerspective = detectPerspective(text);
    if (detectedPerspective && detectedPerspective !== settings.perspective) {
        violations.push({
            type: 'perspective',
            description: `Wrong perspective (detected: ${detectedPerspective}, expected: ${settings.perspective})`
        });
    }

    return violations;
}

// Detect if AI is controlling user character
function detectUserControl(text) {
    if (!settings.protectUser || settings.userNames.length === 0) {
        return false;
    }

    const violations = [];

    // Build pattern for each user name
    settings.userNames.forEach(userName => {
        if (!userName) return;

        const escaped = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Direct patterns (existing)
        const directPatterns = [
            // Actions: "Ryder walks", "Ryder's eyes"
            new RegExp(`\\b${escaped}\\s+(walks?|runs?|moves?|steps?|turns?|looks?|feels?|thinks?|says?|speaks?|grabs?|holds?|takes?|gives?|does?|did|goes|went|comes?|came)\\b`, 'gi'),
            new RegExp(`\\b${escaped}'s\\s+(eyes?|hands?|fingers?|body|face|voice|heart|mind|thoughts?|arms?|legs?|chest|breath)\\b`, 'gi'),
            new RegExp(`\\b${escaped}'s\\s+(\\w+)\\s+(clenched?|trembled?|shook|tensed?|relaxed|tightened?|widened?|narrowed?|flickered?)\\b`, 'gi'),
        ];

        // Possessive + action patterns (enhanced for body swap scenarios)
        const possessivePatterns = [
            // "his hands", "her eyes" when referring to user
            new RegExp(`\\b(his|her|their)\\s+(hands?|fingers?|eyes?|face|body|arms?|legs?|chest|breath|voice|heart)\\b`, 'gi'),
            // "he felt", "she thought"  
            new RegExp(`\\b(he|she|they)\\s+(felt|thought|knew|realized|wondered|decided|wanted|needed|saw|heard|noticed|sensed)\\b`, 'gi'),
            // "[User]'s body" + action
            new RegExp(`\\b${escaped}'s\\s+body\\b`, 'gi'),
        ];

        // Test all patterns
        directPatterns.forEach(pattern => {
            if (pattern.test(text)) {
                violations.push(`Direct user control detected: "${userName}" being controlled`);
            }
        });

        // For possessive patterns, only flag if user name appears in same paragraph
        // This reduces false positives
        const paragraphs = text.split(/\n\n+/);
        paragraphs.forEach(para => {
            const hasUserName = new RegExp(`\\b${escaped}\\b`, 'i').test(para);
            if (hasUserName) {
                possessivePatterns.forEach(pattern => {
                    if (pattern.test(para)) {
                        violations.push(`Possessive user control detected: pronouns/body parts referring to "${userName}"`);
                    }
                });
            }
        });
    });

    return violations.length > 0 ? violations[0] : false;
}

// Detect perspective
function detectPerspective(text) {
    const firstPerson = (text.match(/\b(I|me|my|mine|myself)\b/gi) || []).length;
    const secondPerson = (text.match(/\b(you|your|yours|yourself)\b/gi) || []).length;
    const thirdPerson = (text.match(/\b(he|she|they|him|her|them|his|hers|their|theirs)\b/gi) || []).length;

    const total = firstPerson + secondPerson + thirdPerson;
    if (total === 0) return null;

    const firstPct = firstPerson / total;
    const secondPct = secondPerson / total;
    const thirdPct = thirdPerson / total;

    if (firstPct > 0.4) return '1st';
    if (secondPct > 0.3) return '2nd';
    if (thirdPct > 0.4) return '3rd';

    return null;
}

// QUALITY MODE - AI Rewrite
async function aiRewrite(text, violations) {
    const violationsList = violations.map(v => `- ${v.type}: ${v.description}`).join('\\n');

    const perspectiveName = {
        '1st': 'first',
        '2nd': 'second',
        '3rd': 'third'
    }[settings.perspective] || 'third';

    // Generate specific, high-priority instructions for each violation
    const criticalFixes = [];

    // 1. Perspective Fixes
    if (violations.some(v => v.type === 'perspective')) {
        criticalFixes.push(`CRITICAL: You MUST write in ${perspectiveName} person (I/me/my for 1st, He/She/They for 3rd). Do NOT use 'You'.`);
    }

    // 2. Formatting/Structure Fixes
    if (violations.some(v => v.type === 'paragraphs')) {
        criticalFixes.push(`CRITICAL: MERGE text into maximum ${settings.maxParagraphs} paragraphs. Current is too long.`);
    }

    if (violations.some(v => v.type === 'dialogues')) {
        criticalFixes.push(`CRITICAL: ADD DIALOGUE. Ensure at least ${settings.minDialogues} lines of spoken text. Characters must speak.`);
    }

    // 3. Length Fixes
    if (violations.some(v => v.type === 'word_count')) {
        const textWords = text.trim().split(/\s+/).length;
        if (textWords < settings.minWords) {
            criticalFixes.push(`CRITICAL: EXPAND the scene. Add sensory details and internal monologue to reach at least ${settings.minWords} words.`);
        } else if (textWords > settings.maxWords) {
            criticalFixes.push(`CRITICAL: CONDENSE the scene. Cut fluff to get under ${settings.maxWords} words.`);
        }
    }

    // 4. User Protection
    // Resolve {{user}} macro to actual name
    const context = SillyTavern.getContext();
    const userName = context.name1 || 'User';
    const charName = context.name2 || 'The Character';
    const protectedNames = settings.userNames.map(n => n.replace(/{{user}}/gi, userName));

    // Debug logging to verify names
    console.log(`${LOG_PREFIX} Character Names - User: "${userName}", Character: "${charName}"`);
    addDebugLog(`Using names - User: "${userName}", Character: "${charName}"`);

    if (violations.some(v => v.type === 'user_control')) {
        criticalFixes.push(`CRITICAL: Do NOT describe thoughts, feelings, or actions for: ${protectedNames.join(', ')}. Focus ONLY on the other character(s).`);
    }

    const criticalSection = criticalFixes.length > 0
        ? `\nCRITICAL FIXES (MANDATORY):\n${criticalFixes.map(f => `- ${f}`).join('\n')}\n`
        : '';

    // 5. Formatting Enhancements
    let formattingInstructions = "";

    if (settings.separateDialogue) {
        formattingInstructions += "5. **Dialogue Isolation:** Spoken dialogue MUST be on its own line. Do not bury speech inside narration paragraphs.\n";
    }

    if (settings.enableVisualEffects) {
        formattingInstructions += `
### **Visual Text Effects**
When weaving strong mood, emotion, or psychological states, **enhance the text visually with inline CSS**.
**Core Toolkit:**
- \`text-shadow\`: glow for magic/ethereal (e.g. \`0 0 8px #color\`), blur for confusion, multiple shadows for echo/trembling
- \`opacity\`: fade uncertain, dreamlike, or fading text
- \`letter-spacing\`: expand for emphasis or dread
- \`filter\`: blur(0.5px) for haze/intoxication
**Syntax:** \`<span style='property: value; background: transparent;'>text</span>\`
**Constraint:** ALWAYS include \`background: transparent;\`.
`;
    }

    const prompt = `You are an expert Roleplay Director. Rewrite the text to be visceral, immersive, and strictly adhering to constraints.

IDENTITY STRICTLY ENFORCED:
- AI Character: ${charName}
- User Character: ${userName}

CRITICAL RULES:
1. NO IDENTITY THEFT: Never write thoughts, feelings, or dialogue for ${userName}.
2. NO USER DIALOGUE: Do not make ${userName} speak.
3. SHOW, DON'T TELL: Eliminate clichés like "heart raced" or "shivered". Use concrete physical details.

DETECTED ISSUES:
${violationsList}

ORIGINAL TEXT:
${text}

DIRECTOR'S INSTRUCTIONS:
${criticalSection}
- Perspective: ${perspectiveName} person ONLY.
${formattingInstructions}

TASK:
Output ONLY the final rewritten story text. Do not provide analysis, <thinking> tags, or introductory remarks.`;


    try {
        let result;

        // Use specific connection profile if configured
        if (settings.connectionProfile && settings.connectionProfile.trim() !== '') {
            addDebugLog(`Quality Mode: Using connection profile "${settings.connectionProfile}"`);

            const messages = [
                { role: 'system', content: 'You are a helpful assistant.' }, // Generic system prompt, the real instruction is in the user prompt for this specific task
                { role: 'user', content: prompt }
            ];

            addDebugLog(`Quality Mode: Sending request to ConnectionManagerRequestService...`);
            const response = await ConnectionManagerRequestService.sendRequest(
                settings.connectionProfile,
                messages,
                2048, // Max new tokens
                {
                    includePreset: true,
                    includeInstruct: false, // We provide our own instructions in the prompt
                    stream: false
                }
            );

            addDebugLog(`Quality Mode: Connection Manager returned type: ${typeof response}`);
            console.log(`${LOG_PREFIX} RAW RESPONSE:`, response); // Console log for deep inspection

            // Handle different response structures
            if (typeof response === 'string') {
                result = response;
                addDebugLog(`Quality Mode: Response was string string length=${result.length}`);
            } else if (response && response.content) {
                result = response.content;
                addDebugLog(`Quality Mode: Response content length=${result.length}`);
            } else if (response && response.text) { // Some adapters return text
                result = response.text;
                addDebugLog(`Quality Mode: Response text length=${result.length}`);
            } else {
                addDebugLog(`Quality Mode: Invalid response structure: ${JSON.stringify(response)}`);
                throw new Error('Invalid response from Connection Manager');
            }

        } else {
            // Fallback to default connection
            addDebugLog('Quality Mode: Using default connection (generateQuietPrompt)');
            result = await generateQuietPrompt({ quietPrompt: prompt });
            addDebugLog(`Quality Mode: Default connection returned length=${result ? result.length : 'null'}`);
        }

        // Direct return for speed (no CoT parsing needed)
        addDebugLog(`Quality Mode: Returning direct result, length=${result.length}`);
        return result.trim();

    } catch (error) {
        console.error(`${LOG_PREFIX} AI rewrite failed: `, error);
        addDebugLog(`AI rewrite failed: ${error.message}`);
        return text; // Return original on error
    }
}

// Show processing overlay on a message
function showProcessingOverlay(messageId) {
    const $message = $(`#chat.mes[mesid = "${messageId}"]`);
    if ($message.length === 0) return;

    // Remove any existing overlay
    $message.find('.asf-processing-overlay').remove();

    // Add overlay
    const $overlay = $(`
        <div class="asf-processing-overlay" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--SmartThemeBodyColor);
            z-index: 100;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100;
            border-radius: 5px;
        ">
            <div style="text-align: center; color: white;">
                <div class="asf-spinner" style="
                    width: 40px;
                    height: 40px;
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid var(--SmartThemeBlurTintColor);
                    border-radius: 50%;
                    animation: asf-spin 1s linear infinite;
                    margin: 0 auto 10px;
                "></div>
                <div style="font-weight: bold;">AI Fixing Slop...</div>
                <div style="font-size: 0.8em; opacity: 0.8;">Applying quality filters</div>
            </div>
            <style>
                @keyframes asf-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </div>
    `);

    $message.css('position', 'relative');
    $message.append($overlay);

    // Text is already hidden by .asf-processing-text class (color: transparent)
    // No need for additional visibility hiding
}

// Hide processing overlay
function hideProcessingOverlay(messageId) {
    const $message = $(`#chat .mes[mesid="${messageId}"]`);
    $message.find('.asf-processing-overlay').fadeOut(300, function () {
        $(this).remove();
    });

    // Remove the masking and skeleton classes to allow text to fade back in
    $message.find('.mes_text').removeClass('asf-processing-text asf-skeleton-pulse');
}

// Main message processing
async function processMessage(messageId) {
    if (!isAppReady) return;

    const context = getContext();
    const message = context.chat[messageId];
    if (!message || message.is_user) return;

    // FIX #2: Prevent infinite render loop with session flag
    if (message.flags && message.flags.includes('slop_fixed')) {
        console.log(`${LOG_PREFIX} Message ${messageId} already processed, skipping`);
        return;
    }

    // IMMEDIATE ACTION: Hide text to prevent FOUC (Flash of Unstyled Content)
    // This ensures the user never sees the original "slop" text during processing
    const $message = $(`#chat .mes[mesid="${messageId}"]`);
    const $messageText = $message.find('.mes_text');
    $messageText.addClass('asf-processing-text asf-skeleton-pulse');

    // Reset diagnostic state for new run
    currentDiagnostic = {
        originalText: message.mes,
        rewrittenText: message.mes,
        tokenCount: 0,
        debugLogs: [],
        timestamp: new Date(),
        modesUsed: []
    };

    addDebugLog('Starting message processing');
    addDebugLog(`Original message length: ${message.mes.length} characters`);

    let currentText = message.mes;
    let wasModified = false;

    // FIX #1: Use optimized Static Fixer (Module A) instead of slow regex logic
    if (settings.fastModeEnabled) {
        addDebugLog('Fast Mode: Using optimized Static Fixer (Module A)');
        const staticResult = StaticFixer.process(currentText);
        if (staticResult !== currentText) {
            currentText = staticResult;
            wasModified = true;
            currentDiagnostic.modesUsed.push('Fast Mode (Static Fixer)');
            addDebugLog('Fast Mode: Applied static fixes (< 5ms)');
        } else {
            addDebugLog('Fast Mode: No patterns matched');
        }

        // Also analyze in background with Passive Watcher (Module B)
        PassiveWatcher.analyzeMessage(currentText);
        addDebugLog('Passive Watcher: Background analysis started');
    }

    // QUALITY MODE
    messageCount++;
    const shouldRunQuality = settings.qualityModeEnabled &&
        !settings.qualityModeManualOnly &&
        messageCount % settings.qualityModeInterval === 0;

    if (shouldRunQuality) {
        addDebugLog(`Quality Mode: Triggered(message ${messageCount}, interval ${settings.qualityModeInterval})`);
        const violations = detectViolations(currentText);

        if (violations.length > 0) {
            addDebugLog(`Quality Mode: Found ${violations.length} violations`);
            violations.forEach((v, i) => {
                addDebugLog(`  Violation ${i + 1}: ${v.type} - ${v.description} `);
            });

            addDebugLog('Quality Mode: Sending to AI for rewrite...');

            // Show processing overlay
            showProcessingOverlay(messageId);

            const beforeRewrite = currentText;
            currentText = await aiRewrite(currentText, violations);
            wasModified = true;
            currentDiagnostic.modesUsed.push('Quality Mode');

            // Rough token estimation (words * 1.3)
            const wordCount = beforeRewrite.split(/\s+/).length;
            currentDiagnostic.tokenCount = Math.ceil(wordCount * 1.3);

            addDebugLog(`Quality Mode: AI rewrite complete(est.${currentDiagnostic.tokenCount} tokens)`);

            // LEARNING MODE: Extract patterns from this rewrite
            if (settings.learningEnabled) {
                addDebugLog('Learning Mode: Analyzing rewrite for patterns');
                const extractedPatterns = extractPatterns(currentDiagnostic.originalText, currentText);
                if (extractedPatterns.length > 0) {
                    addDebugLog(`Learning Mode: Found ${extractedPatterns.length} pattern candidates`);
                    learnFromPatterns(extractedPatterns);
                }
            }
        } else {
            addDebugLog('Quality Mode: No violations detected');
        }
    }

    // Update diagnostic state with final result
    currentDiagnostic.rewrittenText = currentText;

    // Update message if modified
    // Update diagnostics
    currentDiagnostic.rewrittenText = currentText;

    // If something changed, either show diff or auto-apply
    if (wasModified) {
        addDebugLog('Changes detected');
        hideProcessingOverlay(messageId);

        // Check if user wants to review changes
        if (!settings.autoMode) {
            addDebugLog('Manual mode: Showing diff for approval');
            const accepted = await showDiffPopup(message.mes, currentText);

            if (!accepted) {
                addDebugLog('User rejected changes');
                showNotification('Changes rejected', 'info');
                return;
            }

            addDebugLog('User accepted changes');
        }

        // Apply changes - Final Response Processor also uses this method!
        try {
            const context = getContext();
            const message = context.chat[messageId];
            message.mes = currentText;
            await saveChatConditional();

            // Mark as processed to prevent re-processing (FIX #2)
            if (!message.flags) message.flags = [];
            message.flags.push('slop_fixed');

            // Update the visual display using native SillyTavern function
            updateMessageBlock(parseInt(messageId), message);

            addDebugLog('Message updated successfully');
            showNotification('Message fixed successfully', 'success');
        } catch (error) {
            console.error(`${LOG_PREFIX} Error updating message: `, error);
            addDebugLog(`Error updating message: ${error.message} `);
            showNotification('Error updating message', 'error');
        }

        // Hide processing overlay
        hideProcessingOverlay(messageId);

        addDebugLog('Message updated successfully');
    } else {
        addDebugLog('No modifications needed');

        // Remove masking class even if no changes were made
        const $message = $(`#chat .mes[mesid="${messageId}"]`);
        $message.find('.mes_text').removeClass('asf-processing-text asf-skeleton-pulse');
    }

    // Save this run to history
    saveDiagnosticToHistory();

    // Update diagnostics panel if visible
    updateDiagnosticsPanel();
}

// -----------------------------------------------------------------------------
// PER-MESSAGE REFINEMENT BUTTONS
// -----------------------------------------------------------------------------

/**
 * Add refinement buttons to all existing AI messages
 */
function addRefinementButtons() {
    const context = getContext();
    if (!context || !context.chat) return;

    const $messages = $('#chat .mes');
    $messages.each(function () {
        const messageId = $(this).attr('mesid');
        if (messageId) {
            addRefinementButtonToElement($(this), parseInt(messageId));
            addGuidedSwipeButtonToElement($(this), parseInt(messageId));
        }
    });
}

/**
 * Add refinement button to a newly rendered message by ID
 * @param {number} messageId - The message ID
 */
async function addRefinementButtonToMessage(messageId) {
    const context = getContext();
    if (!context || !context.chat) return;

    const message = context.chat[messageId];
    if (!message || message.is_user || message.is_system) return;

    // Small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    const $messageElement = $(`#chat.mes[mesid = "${messageId}"]`);
    if ($messageElement.length) {
        addRefinementButtonToElement($messageElement, messageId);
        addGuidedSwipeButtonToElement($messageElement, messageId);
    }
}

/**
 * Add refinement button to a message DOM element
 * @param {jQuery} $messageElement - The message element
 * @param {number} messageId - The message ID
 */
function addRefinementButtonToElement($messageElement, messageId) {
    // Don't add if already exists
    if ($messageElement.find('.asf-refine-button').length > 0) {
        return;
    }

    const $button = $(`
        <div class="mes_button asf-refine-button" title="Fix AI slop in this message">
            <i class="fa-solid fa-sparkles"></i>
            <span>Fix Slop</span>
        </div>
        `);

    $button.on('click', async function (e) {
        e.stopPropagation();

        const $btn = $(this);
        const originalHtml = $btn.html();

        // Show processing state
        $btn.html('<i class="fa-solid fa-spinner fa-spin"></i> Processing...');
        $btn.prop('disabled', true);

        try {
            await processMessage(messageId);

            // Show success state briefly
            $btn.html('<i class="fa-solid fa-check"></i> Done!');
            setTimeout(() => {
                $btn.html(originalHtml);
                $btn.prop('disabled', false);
            }, 2000);
        } catch (error) {
            console.error(`${LOG_PREFIX} Error processing message: `, error);
            $btn.html('<i class="fa-solid fa-xmark"></i> Error');
            setTimeout(() => {
                $btn.html(originalHtml);
                $btn.prop('disabled', false);
            }, 2000);
        }
    });

    // Find the button container and add our button
    const $buttonContainer = $messageElement.find('.mes_buttons');
    if ($buttonContainer.length) {
        $buttonContainer.append($button);
    }
}

/**
 * Add Guided Swipe button to a message element (custom instruction regeneration)
 * @param {jQuery} $messageElement - The message element
 * @param {number} messageId - The message ID
 */
function addGuidedSwipeButtonToElement($messageElement, messageId) {
    // Check if button already exists
    if ($messageElement.find('.asf-guided-swipe-button').length > 0) {
        return;
    }

    const $buttonContainer = $messageElement.find('.mes_buttons');
    if ($buttonContainer.length === 0) return;

    // Create button
    const $button = $('<div class="mes_button asf-guided-swipe-button">')
        .attr('title', 'Regenerate with custom instructions')
        .html('<i class="fa-solid fa-wand-magic-sparkles"></i>');

    const handler = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Prompt user for instructions
        const instruction = prompt('Enter instructions for regeneration:\n\n(e.g., "add more dialogue", "make her more confident", "shorter")');

        if (!instruction || instruction.trim() === '') {
            return; // User cancelled or empty input
        }

        // Show processing state
        $button.addClass('fa-spin');
        $button.find('i').removeClass('fa-wand-magic-sparkles').addClass('fa-spinner');

        try {
            const context = getContext();
            const message = context.chat[messageId];

            if (!message || message.is_user) {
                showNotification('Can only regenerate AI messages', 'error');
                return;
            }

            addDebugLog(`Guided Swipe: Regenerating message ${messageId} with instruction: "${instruction}"`);

            // Build guided prompt (similar to GuidedGenerations)
            const guidedPrompt = `[Take the following into special consideration for your rewrite: ${instruction.trim()}]

Original message:
${message.mes}

Rewrite the message considering the instruction above.Output ONLY the rewritten message, no explanations.`;

            // Call AI
            const result = await generateQuietPrompt({ quietPrompt: guidedPrompt });
            const rewrittenText = result.trim();

            if (!rewrittenText || rewrittenText === message.mes) {
                showNotification('No changes made', 'info');
                addDebugLog('Guided Swipe: AI returned no changes');
                return;
            }

            // Show diff UI if auto-mode is off
            if (!settings.autoMode) {
                const accepted = await showDiffPopup(message.mes, rewrittenText);
                if (!accepted) {
                    showNotification('Changes rejected', 'info');
                    addDebugLog('Guided Swipe: User rejected changes');
                    return;
                }
            }

            // Apply changes
            message.mes = rewrittenText;
            await saveChatConditional();

            // Update visual display
            const $messageText = $messageElement.find('.mes_text');
            $messageText.html(messageFormatting(rewrittenText, message.name, message.is_system, message.is_user));

            showNotification('Message regenerated successfully', 'success');
            addDebugLog('Guided Swipe: Successfully regenerated message');

        } catch (error) {
            console.error(`${LOG_PREFIX} Guided Swipe error: `, error);
            addDebugLog(`Guided Swipe error: ${error.message} `);
            showNotification('Regeneration failed', 'error');
        } finally {
            // Restore button
            $button.removeClass('fa-spin');
            $button.find('i').removeClass('fa-spinner').addClass('fa-wand-magic-sparkles');
        }
    };

    $button.on('click', handler);
    $buttonContainer.append($button);
}

// -----------------------------------------------------------------------------
// GUIDED RESPONSE BUTTON (Chat Input)
// -----------------------------------------------------------------------------

/**
 * Add Guided Response button to chat input area
 * Takes user's typed instructions and guides the next AI response
 */
function addGuidedResponseButton() {
    // Find send button container
    const $sendForm = $('#send_form');
    const $sendButton = $('#send_but');

    if ($sendForm.length === 0 || $sendButton.length === 0) {
        console.warn(`${LOG_PREFIX} Could not find send form or send button`);
        return;
    }

    // Check if button already exists
    if ($('#asf_guided_response_button').length > 0) {
        return;
    }

    // Create guided response button
    const $guidedButton = $('<div id="asf_guided_response_button" class="fa-solid fa-dog" title="Send as guided instruction for next AI response"></div>');
    $guidedButton.css({
        'cursor': 'pointer',
        'padding': '10px',
        'display': 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center'
    });

    // Click handler
    $guidedButton.on('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const $sendButton = $('#send_but');
        const $guidedButton = $('#asf_guided_response_button');

        if (!$sendButton.length) {
            return;
        }

        // Get input text
        const $textarea = $('#send_textarea');
        const instruction = $textarea.val().trim();

        if (!instruction) {
            showNotification('Please type instructions first', 'info');
            return;
        }

        try {
            // Show processing
            $guidedButton.addClass('fa-spin');
            $guidedButton.removeClass('fa-dog').addClass('fa-spinner');

            addDebugLog(`Guided Response: Sending instruction: "${instruction}"`);

            // Use /inject command like GuidedGenerations does
            // This is the CORRECT way to inject instructions
            const promptTemplate = settings.guidedResponsePrompt || '{{input}}';
            const filledPrompt = promptTemplate.replace('{{input}}', instruction);
            const depth = settings.guidedResponseDepth || 0;

            // Corrected syntax: No spaces around equals, no space after slash
            const stscriptCommand = `/inject id=instruct position=chat ephemeral=true scan=true depth=${depth} role=system ${filledPrompt} | /trigger await=true`;

            // Execute the slash command
            if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
                const context = SillyTavern.getContext();

                // Clear the textarea BEFORE executing
                const savedInput = instruction;
                $textarea.val('');

                await context.executeSlashCommandsWithOptions(stscriptCommand);

                addDebugLog('Guided Response: Instruction applied and generation triggered');

                // Restore input after generation
                eventSource.once(event_types.GENERATION_ENDED, () => {
                    $textarea.val(savedInput);
                });
            }

            showNotification('Instruction sent - generating response', 'success');

        } catch (error) {
            console.error(`${LOG_PREFIX} Guided Response error:`, error);
            addDebugLog(`Guided Response error: ${error.message}`);
            showNotification('Failed to send guided instruction', 'error');
        } finally {
            // Restore button
            setTimeout(() => {
                $guidedButton.removeClass('fa-spin fa-spinner').addClass('fa-dog');
            }, 1000);
        }
    });

    // Add button next to send button
    $sendButton.before($guidedButton);

    addDebugLog('Guided Response button added to chat input');
}

// Settings management
// loadSettings removed (duplicate)

// Update diagnostics panel in settings
function updateDiagnosticsPanel() {
    // Only update if settings panel exists and is visible
    if ($('#asf_original_text').length === 0) return;

    if (diagnosticsHistory.length === 0) {
        $('#asf_diagnostics_status').text('No messages processed yet');
        return;
    }

    // Show most recent diagnostic (first in array)
    const latest = diagnosticsHistory[0];

    const modesText = latest.modesUsed.length > 0
        ? latest.modesUsed.join(' + ')
        : 'No changes made';

    $('#asf_diagnostics_status').text(`Last run: ${latest.timestamp.toLocaleString()} | Modes: ${modesText}`);
    $('#asf_original_text').val(latest.originalText);
    $('#asf_rewritten_text').val(latest.rewrittenText);
    $('#asf_token_count').text(latest.tokenCount > 0
        ? `~${latest.tokenCount} tokens`
        : 'N/A');

    // Update debug log
    if (settings.debugMode && latest.debugLogs.length > 0) {
        $('#asf_debug_log').val(latest.debugLogs.join('\n'));
    } else {
        $('#asf_debug_log').val(settings.debugMode ? 'No debug logs for this run' : 'Debug mode is off. Enable it to see logs.');
    }

    // Update history dropdown
    updateHistoryDropdown();
}

function updateHistoryDropdown() {
    const $select = $('#asf_history_select');
    if ($select.length === 0) return;

    $select.empty();

    diagnosticsHistory.forEach((diag, index) => {
        const timeStr = diag.timestamp.toLocaleTimeString();
        const summary = diag.modesUsed.length > 0 ? diag.modesUsed.join('+') : 'No changes';
        $select.append(`<option value="${index}">${timeStr} - ${summary}</option>`);
    });

    // Select most recent
    $select.val('0');
}

// applySettingsToUI removed (duplicate)

function bindSettingsHandlers() {
    $('#asf_fast_mode').on('change', function () {
        settings.fastModeEnabled = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_quality_mode').on('change', function () {
        settings.qualityModeEnabled = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_quality_interval').on('input', function () {
        settings.qualityModeInterval = parseInt($(this).val()) || 5;
        saveSettings();
    });

    $('#asf_quality_manual').on('change', function () {
        settings.qualityModeManualOnly = $(this).prop('checked');
        saveSettings();
    });

    // Connection Profile Handler - Initialize dropdown with ConnectionManagerRequestService
    console.log(`${LOG_PREFIX} Initializing connection profile dropdown...`);
    try {
        if (typeof ConnectionManagerRequestService === 'undefined') {
            console.error(`${LOG_PREFIX} ConnectionManagerRequestService is undefined!`);
        } else {
            console.log(`${LOG_PREFIX} ConnectionManagerRequestService found, calling handleDropdown`);
            ConnectionManagerRequestService.handleDropdown(
                '#asf_connection_profile',
                settings.connectionProfile || '',
                async (profile) => {
                    // onChange handler
                    settings.connectionProfile = profile?.id || '';
                    saveSettings();
                    console.log(`${LOG_PREFIX} Connection profile changed to:`, settings.connectionProfile);
                },
                () => { console.log(`${LOG_PREFIX} Profile created`); }, // onCreate
                () => { console.log(`${LOG_PREFIX} Profile updated`); }, // onUpdate
                () => { console.log(`${LOG_PREFIX} Profile deleted`); }  // onDelete
            );
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} Connection Manager not available:`, error);
    }

    $('#asf_min_words, #asf_max_words, #asf_min_paragraphs, #asf_max_paragraphs, #asf_min_dialogues, #asf_max_dialogues').on('input', function () {
        settings.minWords = parseInt($('#asf_min_words').val()) || 0;
        settings.maxWords = parseInt($('#asf_max_words').val()) || 999;
        settings.minParagraphs = parseInt($('#asf_min_paragraphs').val()) || 0;
        settings.maxParagraphs = parseInt($('#asf_max_paragraphs').val()) || 999;
        settings.minDialogues = parseInt($('#asf_min_dialogues').val()) || 0;
        settings.maxDialogues = parseInt($('#asf_max_dialogues').val()) || 999;
        saveSettings();
    });

    $('#asf_protect_user').on('change', function () {
        settings.protectUser = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_user_names').on('input', function () {
        settings.userNames = $(this).val().split(',').map(n => n.trim()).filter(n => n);
        saveSettings();
    });

    $('input[name="asf_perspective"]').on('change', function () {
        settings.perspective = $(this).val();
        saveSettings();
    });

    // Formatting & Immersion handlers
    $('#asf_visual_effects').on('change', function () {
        settings.enableVisualEffects = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_separate_dialogue').on('change', function () {
        settings.separateDialogue = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_debug_mode').on('change', function () {
        settings.debugMode = $(this).prop('checked');
        saveSettings();
        updateDiagnosticsPanel(); // Refresh panel to show/hide debug logs
    });

    // History selector handler
    $('#asf_history_select').on('change', function () {
        const index = parseInt($(this).val());
        if (isNaN(index) || index >= diagnosticsHistory.length) return;

        const diag = diagnosticsHistory[index];
        if (diag) {
            $('#asf_diagnostics_status').html(`Message ${diag.messageId} (${new Date(diag.timestamp).toLocaleString()})`);
            $('#asf_original_text').val(diag.originalText);
            $('#asf_rewritten_text').val(diag.rewrittenText || diag.originalText);
            $('#asf_token_count').text(diag.tokenUsage ? `${diag.tokenUsage} tokens` : 'N/A');
            $('#asf_debug_log').val(diag.debugLogs.join('\n'));
        } else {
            $('#asf_debug_log').val(settings.debugMode ? 'No debug logs for this run' : 'Debug mode is off');
        }
    });

    // Copy debug log to clipboard
    $('#asf_copy_log').on('click', async () => {
        const logText = $('#asf_debug_log').val();

        if (!logText || logText === 'No debug logs for this run' || logText === 'Debug mode is off. Enable it to see logs.' || logText === 'Debug mode is off') {
            showNotification('No debug logs to copy', 'info');
            return;
        }

        try {
            await navigator.clipboard.writeText(logText);
            showNotification('Debug log copied to clipboard!', 'success');
        } catch (err) {
            console.error('Failed to copy:', err);
            // Fallback for older browsers
            const $temp = $('<textarea>').val(logText).appendTo('body').select();
            document.execCommand('copy');
            $temp.remove();
            showNotification('Debug log copied to clipboard!', 'success');
        }
    });

    // Export debug log as file
    $('#asf_export_log').on('click', () => {
        const logText = $('#asf_debug_log').val();

        if (!logText || logText === 'No debug logs for this run' || logText === 'Debug mode is off. Enable it to see logs.' || logText === 'Debug mode is off') {
            showNotification('No debug logs to export', 'info');
            return;
        }

        // Get current timestamp for filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `ai-slopfixer-debug-${timestamp}.txt`;

        // Create blob and download
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`Exported as ${filename}`, 'success');
    });

    // Export ALL history (Original + Rewritten text from all runs)
    $('#asf_export_all_history').on('click', () => {
        if (diagnosticsHistory.length === 0) {
            showNotification('No history to export', 'info');
            return;
        }

        // Build comprehensive export
        let exportText = `AI Slop Fixer - Complete History Export\n`;
        exportText += `Generated: ${new Date().toLocaleString()}\n`;
        exportText += `Total Runs: ${diagnosticsHistory.length}\n`;
        exportText += `\n${'='.repeat(80)}\n\n`;

        diagnosticsHistory.forEach((diag, index) => {
            exportText += `\n### RUN #${index + 1} ###\n`;
            exportText += `Timestamp: ${new Date(diag.timestamp).toLocaleString()}\n`;
            exportText += `Message ID: ${diag.messageId || 'N/A'}\n`;
            exportText += `Modes Used: ${diag.modesUsed?.join(', ') || 'None'}\n`;
            exportText += `Token Count: ${diag.tokenCount > 0 ? `~${diag.tokenCount}` : 'N/A'}\n`;
            exportText += `\n--- ORIGINAL TEXT ---\n${diag.originalText}\n`;
            exportText += `\n--- REWRITTEN TEXT ---\n${diag.rewrittenText || '(No changes)'}\n`;

            if (settings.debugMode && diag.debugLogs && diag.debugLogs.length > 0) {
                exportText += `\n--- DEBUG LOG ---\n${diag.debugLogs.join('\n')}\n`;
            }

            exportText += `\n${'-'.repeat(80)}\n`;
        });

        // Get current timestamp for filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `ai-slopfixer-history-${timestamp}.txt`;

        // Create blob and download
        const blob = new Blob([exportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showNotification(`Exported ${diagnosticsHistory.length} runs as ${filename}`, 'success');
    });

    // Learning Mode handlers
    $('#asf_learning_enabled').on('change', function () {
        settings.learningEnabled = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_learn_threshold').on('input', function () {
        settings.learnThreshold = parseInt($(this).val());
        saveSettings();
    });

    $('#asf_max_learned').on('input', function () {
        settings.maxLearnedRules = parseInt($(this).val());
        saveSettings();
    });

    $('#asf_auto_apply_learned').on('change', function () {
        settings.autoApplyLearned = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_view_rules').on('click', function () {
        showRuleManager();
    });

    $('#asf_clear_learned').on('click', async function () {
        const confirmed = confirm(`Clear all ${settings.learnedRules.length} learned rules?`);
        if (confirmed) {
            settings.learnedRules = [];
            patternOccurrences.clear();
            saveSettings();
            await reloadAllPatterns();
            applySettingsToUI();
            console.log(`${LOG_PREFIX} Cleared all learned rules`);
        }
    });

    // Prompt Injection settings
    $('#asf_enable_injection').on('change', function () {
        settings.enablePromptInjection = $(this).prop('checked');
        saveSettings();
    });

    $('#asf_injection_position').on('change', function () {
        settings.promptInjectionPosition = $(this).val();
        saveSettings();
    });

    $('#asf_prevention_instructions').on('change', function () {
        settings.preventionInstructions = $(this).val();
        saveSettings();
    });

    // Auto-mode setting
    $('#asf_auto_mode').on('change', function () {
        settings.autoMode = $(this).prop('checked');
        saveSettings();
    });

    // Preset button handlers
    $('#asf_save_preset').on('click', function () {
        const name = $('#asf_preset_name').val();
        savePreset(name);
    });

    $('#asf_load_preset').on('click', function () {
        const name = $('#asf_preset_select').val();
        loadPreset(name);
    });

    $('#asf_delete_preset').on('click', async function () {
        const name = $('#asf_preset_select').val();
        if (!name) return;

        const confirmed = confirm(`Are you sure you want to delete the preset "${name}"?`);
        if (confirmed) {
            deletePreset(name);
        }
    });

    // Refresh diagnostics when settings panel is opened
    $(document).on('DOMNodeInserted', function (e) {
        if ($(e.target).find('#asf_diagnostics_status').length > 0) {
            updateDiagnosticsPanel();
        }
    });
}


// Preset Management
function updatePresetDropdown() {
    const $select = $('#asf_preset_select');
    $select.empty().append('<option value="">Select a preset...</option>');

    if (settings.presets && settings.presets.length > 0) {
        settings.presets.forEach(preset => {
            const $option = $('<option></option>').val(preset.name).text(preset.name);
            if (settings.current_preset === preset.name) {
                $option.prop('selected', true);
            }
            $select.append($option);
        });
    }
}

function getPresetSettings() {
    const excluded = ['presets', 'current_preset'];
    const presetable = {};
    for (const key in settings) {
        if (!excluded.includes(key)) {
            presetable[key] = settings[key];
        }
    }
    return presetable;
}

function savePreset(name) {
    if (!name || name.trim() === '') {
        console.warn(`${LOG_PREFIX} Please enter a preset name`);
        return;
    }

    name = name.trim();

    // Initialize presets array if needed
    if (!settings.presets) {
        settings.presets = [];
    }

    // Check if preset exists
    const existingIndex = settings.presets.findIndex(p => p.name === name);

    const preset = {
        name: name,
        settings: getPresetSettings(),
        timestamp: new Date().toISOString()
    };

    if (existingIndex >= 0) {
        // Update existing
        settings.presets[existingIndex] = preset;
        console.log(`${LOG_PREFIX} Updated preset "${name}"`);
    } else {
        // Add new
        settings.presets.push(preset);
        console.log(`${LOG_PREFIX} Saved new preset "${name}"`);
    }

    settings.current_preset = name;
    saveSettings();
    updatePresetDropdown();
    $('#asf_preset_name').val('');
}

function loadPreset(name) {
    if (!name) return;

    const preset = settings.presets.find(p => p.name === name);
    if (!preset) {
        console.warn(`${LOG_PREFIX} Preset "${name}" not found`);
        return;
    }

    // Preserve presets array
    const presets = settings.presets;

    // Apply preset settings
    Object.assign(settings, preset.settings);

    // Restore presets array and set current
    settings.presets = presets;
    settings.current_preset = name;

    saveSettings();
    applySettingsToUI();
    console.log(`${LOG_PREFIX} Loaded preset "${name}"`);
}

function deletePreset(name) {
    if (!name) return;

    const index = settings.presets.findIndex(p => p.name === name);
    if (index < 0) {
        console.warn(`${LOG_PREFIX} Preset "${name}" not found`);
        return;
    }

    settings.presets.splice(index, 1);
    if (settings.current_preset === name) {
        settings.current_preset = '';
    }

    saveSettings();
    updatePresetDropdown();
    console.log(`${LOG_PREFIX} Deleted preset "${name}"`);
}


// Rule Manager UI
async function showRuleManager() {
    // Load HTML template
    const html = await $.get(`scripts/extensions/third-party/${EXTENSION_NAME}/rule-manager.html`);

    // Create modal using SillyTavern's popup system
    const popup = $('<div class="asf-rule-manager-popup"></div>').html(html);
    $('body').append(popup);

    // Center the popup
    popup.css({
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        'z-index': 9999,
        'box-shadow': '0 4px 20px rgba(0,0,0,0.5)'
    });

    // Add backdrop
    const backdrop = $('<div class="asf-backdrop"></div>').css({
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        'z-index': 9998
    });
    $('body').append(backdrop);

    // Update counts
    $('#asf_learned_count').text(settings.learnedRules.length);
    $('#asf_builtin_count').text(StaticFixer.getStats().total || 0);

    // Render lists
    renderLearnedRulesList();
    renderBuiltinRulesList();

    // Tab switching
    $('.asf-tab').on('click', function () {
        const tab = $(this).data('tab');
        $('.asf-tab').removeClass('active');
        $(this).addClass('active');
        $('.asf-tab-panel').removeClass('active');
        $(`#asf_${tab}_tab`).addClass('active');
    });

    // Export learned rules
    $('#asf_export_learned').on('click', () => {
        const data = JSON.stringify(settings.learnedRules, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-slop-fixer-learned-rules-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        console.log(`${LOG_PREFIX} Exported ${settings.learnedRules.length} learned rules`);
    });

    // Import learned rules
    $('#asf_import_learned').on('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const text = await file.text();
            try {
                const imported = JSON.parse(text);
                if (!Array.isArray(imported)) throw new Error('Invalid format');

                settings.learnedRules.push(...imported);
                saveSettings();
                // Pattern reloading handled by Module A
                renderLearnedRulesList();
                $('#asf_learned_count').text(settings.learnedRules.length);
                console.log(`${LOG_PREFIX} Imported ${imported.length} rules`);
                alert(`Successfully imported ${imported.length} rules!`);
            } catch (err) {
                alert(`Import failed: ${err.message}`);
            }
        };
        input.click();
    });

    // Clear all learned rules
    $('#asf_clear_all_learned').on('click', () => {
        if (!confirm(`Delete all ${settings.learnedRules.length} learned rules?`)) return;
        settings.learnedRules = [];
        saveSettings();
        reloadAllPatterns();
        renderLearnedRulesList();
        $('#asf_learned_count').text(0);
        console.log(`${LOG_PREFIX} Cleared all learned rules`);
    });

    // Close button
    $('#asf_close_manager, .asf-backdrop').on('click', () => {
        popup.remove();
        backdrop.remove();
    });
}

function renderLearnedRulesList() {
    const $list = $('#asf_learned_list');
    $list.empty();

    if (settings.learnedRules.length === 0) {
        $list.html('<div style="text-align:center;opacity:0.6;padding:20px;">No learned rules yet</div>');
        return;
    }

    settings.learnedRules.forEach((rule, index) => {
        const $item = $(`
            <div class="asf-rule-item">
                <div class="asf-rule-header">
                    <div class="asf-rule-pattern">${escapeHtml(rule.pattern)}</div>
                    <div class="asf-rule-actions">
                        <button class="asf-rule-btn asf-delete-rule" data-index="${index}">🗑️ Delete</button>
                    </div>
                </div>
                <div class="asf-rule-stats">
                    <span>Occurrences: ${rule.count}</span>
                    <span>Added: ${new Date(rule.timestamp).toLocaleDateString()}</span>
                </div>
            </div>
        `);

        $list.append($item);
    });

    // Delete handlers
    $('.asf-delete-rule').on('click', function () {
        const index = parseInt($(this).data('index'));
        const rule = settings.learnedRules[index];
        if (!confirm(`Delete rule: "${rule.pattern}"?`)) return;

        settings.learnedRules.splice(index, 1);
        saveSettings();
        reloadAllPatterns();
        renderLearnedRulesList();
        $('#asf_learned_count').text(settings.learnedRules.length);
        console.log(`${LOG_PREFIX} Deleted learned rule`);
    });
}

function renderBuiltinRulesList() {
    const $list = $('#asf_builtin_list');
    $list.empty();

    slopPatterns.forEach((pattern) => {
        const $item = $(`
            <div class="asf-rule-item">
                <div class="asf-rule-header">
                    <div class="asf-rule-pattern">${escapeHtml(pattern.regex)}</div>
                </div>
                <div class="asf-rule-stats">
                    <span>${pattern.name}</span>
                    <span>${pattern.replacements ? pattern.replacements.length + ' replacements' : 'No replacements'}</span>
                </div>
            </div>
        `);
        $list.append($item);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderLearnedRules() {
    const $list = $('#asf_learned_rules_list');
    $list.empty();

    if (settings.learnedRules.length === 0) {
        $list.html('<small style="opacity: 0.7;">No learned rules yet</small>');
        return;
    }

    settings.learnedRules.forEach((rule, index) => {
        const $rule = $(`
            <div class="rule-item" style="border: 1px solid var(--SmartThemeBorderColor); padding: 10px; margin: 5px 0; border-radius: 5px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <code style="background: var(--black30alpha); padding: 2px 5px; border-radius: 3px;">${rule.pattern}</code>
                        <div style="margin-top: 5px;">
                            <small><strong>Replace with:</strong> ${rule.replacement || '(remove)'}</small><br>
                            <small><strong>Occurrences:</strong> ${rule.occurrences} | <strong>Created:</strong> ${new Date(rule.dateCreated).toLocaleDateString()}</small>
                        </div>
                    </div>
                    <div style="display: flex; gap: 5px;">
                        <button class="menu_button toggle-rule" data-index="${index}" title="${rule.enabled ? 'Disable' : 'Enable'}">
                            <i class="fa-solid fa-${rule.enabled ? 'toggle-on' : 'toggle-off'}"></i>
                        </button>
                        <button class="menu_button delete-rule" data-index="${index}" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `);

        $list.append($rule);
    });

    // Event handlers for rule buttons
    $('.toggle-rule').on('click', function () {
        const index = parseInt($(this).data('index'));
        settings.learnedRules[index].enabled = !settings.learnedRules[index].enabled;
        saveSettings();
        reloadAllPatterns();
        renderLearnedRules();
    });

    $('.delete-rule').on('click', function () {
        const index = parseInt($(this).data('index'));
        if (confirm(`Delete this learned rule?`)) {
            settings.learnedRules.splice(index, 1);
            saveSettingsDebounced();
            // No need to reload patterns - Module A handles this
            renderLearnedRules();
            $('#asf_learned_rules_count').text(settings.learnedRules.length);
            $('#asf_learned_count').text(settings.learnedRules.length);
        }
    });
}

function renderBuiltinRules() {
    const $list = $('#asf_builtin_rules_list');
    $list.empty();

    slopPatterns.forEach(rule => {
        const $rule = $(`
            <div class="rule-item" style="border: 1px solid var(--SmartThemeBorderColor); padding: 10px; margin: 5px 0; border-radius: 5px; opacity: 0.8;">
                <code style="background: var(--black30alpha); padding: 2px 5px; border-radius: 3px;">${rule.pattern}</code>
                <div style="margin-top: 5px;">
                    <small><strong>Replace with:</strong> ${rule.replacement || '(remove)'}</small><br>
                    <small><strong>Category:</strong> ${rule.category}</small>
                </div>
            </div>
        `);

        $list.append($rule);
    });
}

function exportRules() {
    const data = JSON.stringify(settings.learnedRules, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-slopfixer-learned-rules.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log(`${LOG_PREFIX} Exported ${settings.learnedRules.length} learned rules`);
}

async function importRules() {
    const json = await callGenericPopup('Paste exported rules JSON:', POPUP_TYPE.INPUT, '');
    if (!json) return;

    try {
        const imported = JSON.parse(json);
        if (!Array.isArray(imported)) throw new Error('Invalid format');

        settings.learnedRules.push(...imported);
        saveSettings();
        await reloadAllPatterns();
        renderLearnedRules();
        $('#asf_learned_rules_count').text(settings.learnedRules.length);
        console.log(`${LOG_PREFIX} Imported ${imported.length} rules`);
    } catch (error) {
        alert('Invalid JSON format');
        console.error(`${LOG_PREFIX} Import failed:`, error);
    }
}

// Save settings to storage
function saveSettings() {
    // Deep copy to ensure no reference issues with the global settings object
    extension_settings[EXTENSION_NAME] = JSON.parse(JSON.stringify(settings));
    saveSettingsDebounced();
    console.log(`${LOG_PREFIX} Settings saved. Presets: ${settings.presets?.length || 0}`);
}

// Load settings from storage
async function loadSettings() {
    const data = extension_settings[EXTENSION_NAME];
    console.log(`${LOG_PREFIX} Loading settings... Data found:`, !!data);

    if (data) {
        Object.assign(settings, data);

        // Ensure presets is a valid array (fix for persistence issues)
        if (!Array.isArray(settings.presets)) {
            settings.presets = [];
        }
        console.log(`${LOG_PREFIX} Loaded ${settings.presets.length} presets`);
    }
    applySettingsToUI();
}

// Apply settings to UI elements
function applySettingsToUI() {
    $('#asf_min_words').val(settings.minWords);
    $('#asf_max_words').val(settings.maxWords);
    $('#asf_min_paragraphs').val(settings.minParagraphs);
    $('#asf_max_paragraphs').val(settings.maxParagraphs);
    $('#asf_min_dialogues').val(settings.minDialogues);
    $('#asf_max_dialogues').val(settings.maxDialogues);
    $('#asf_protect_user').prop('checked', settings.protectUser);
    $('#asf_user_names').val(settings.userNames.join(', '));
    $(`input[name="asf_perspective"][value="${settings.perspective}"]`).prop('checked', true);
    $('#asf_learning_enabled').prop('checked', settings.learningEnabled);
    $('#asf_learn_threshold').val(settings.learnThreshold);
    $('#asf_max_learned').val(settings.maxLearnedRules);
    $('#asf_auto_apply_learned').prop('checked', settings.autoApplyLearned);
    $('#asf_enable_injection').prop('checked', settings.enablePromptInjection);
    $('#asf_injection_position').val(settings.promptInjectionPosition);
    $('#asf_prevention_instructions').val(settings.preventionInstructions);
    $('#asf_auto_mode').prop('checked', settings.autoMode);
    $('#asf_debug_mode').prop('checked', settings.debugMode);

    // Missing fields found during debug
    $('#asf_fast_mode').prop('checked', settings.fastModeEnabled);
    $('#asf_quality_mode').prop('checked', settings.qualityModeEnabled);
    $('#asf_quality_interval').val(settings.qualityModeInterval);
    $('#asf_quality_manual').prop('checked', settings.qualityModeManualOnly);
    $('#asf_connection_profile').val(settings.connectionProfile);

    // Formatting & Immersion
    $('#asf_visual_effects').prop('checked', settings.enableVisualEffects);
    $('#asf_separate_dialogue').prop('checked', settings.separateDialogue);

    // Update counts
    $('#asf_learned_rules_count').text(settings.learnedRules.length);
    updatePresetDropdown();
}

// Register Slash Command
function registerSlashCommand() {
    if (typeof SillyTavern.registerSlashCommand === 'function') {
        SillyTavern.registerSlashCommand('fixslop', async (args, value) => {
            const context = getContext();
            const chat = context.chat;
            if (!chat || chat.length === 0) return;

            const lastMessageId = chat.length - 1;
            console.log(`${LOG_PREFIX} Manually triggering fix for message ${lastMessageId}`);
            await processMessage(lastMessageId, true); // force manual mode
        }, [], 'Analyze and fix AI slop in the last message', true, true);
    }
}

// Initialize extension
jQuery(async () => {
    console.log(`${LOG_PREFIX} Initializing...`);

    // Patterns now loaded by Module A (Static Fixer) in APP_READY event

    // Load Settings HTML from file
    try {
        const settingsHtml = await $.get(`scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`);
        $('#extensions_settings').append(settingsHtml);

        // Initialize handlers only AFTER html is loaded
        bindSettingsHandlers();
        initConnectionDropdown();

        // Apply settings if app is already ready
        if (typeof isAppReady !== 'undefined' && isAppReady) {
            applySettingsToUI();
        }
    } catch (e) {
        console.error(`${LOG_PREFIX} Failed to load settings.html`, e);
    }

    eventSource.on(event_types.APP_READY, async () => {
        await loadSettings();
        registerSlashCommand(); // Register command
        isAppReady = true;

        // FIX #1: Initialize optimized modules (Prose Polisher logic)
        console.log(`${LOG_PREFIX} Initializing optimized modules...`);

        // Module A: Static Fixer
        try {
            await StaticFixer.loadRules(`scripts/extensions/third-party/${EXTENSION_NAME}/regex_rules.json`);
            console.log(`${LOG_PREFIX} Module A (Static Fixer) initialized:`, StaticFixer.getStats());
        } catch (error) {
            console.warn(`${LOG_PREFIX} Failed to load regex_rules.json, Module A disabled:`, error.message);
        }

        // Module B: Passive Watcher
        PassiveWatcher.settings.slopThreshold = 5.0;
        PassiveWatcher.settings.messagesToAnalyze = 20;
        console.log(`${LOG_PREFIX} Module B (Passive Watcher) initialized`);

        // Module C: Proactive Injector
        ProactiveInjector.setEnabled(true);
        ProactiveInjector.setInjectionMode('system');
        console.log(`${LOG_PREFIX} Module C (Proactive Injector) initialized`);

        // Analyze existing chat history
        const context = getContext();
        if (context.chat && context.chat.length > 0) {
            const results = PassiveWatcher.analyzeChatHistory(context.chat);
            ProactiveInjector.updateOverusedPhrases(results.overusedPhrases);
            console.log(`${LOG_PREFIX} Initial analysis: ${results.analyzed} messages, ${results.overusedPhrases.length} overused phrases`);
        }

        console.log(`${LOG_PREFIX} ✓ All modules initialized successfully`);

        // Ensure UI is updated if HTML loaded first
        applySettingsToUI();

        // Re-run connection dropdown init cleanly
        initConnectionDropdown();

        console.log(`${LOG_PREFIX} Extension ready!`);



        // Add Guided Response button to chat input
        addGuidedResponseButton();


        // Add buttons to existing messages after a small delay
        setTimeout(() => {
            addRefinementButtons();
        }, 500);
    });

    // FIX #3: Only process latest message, not all history
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
        const context = getContext();
        // Only process if it's the very last message (prevents history rewrite on load)
        if (Number(mesId) === context.chat.length - 1) {
            console.log(`${LOG_PREFIX} Processing latest message: ${mesId}`);
            processMessage(mesId);
        } else {
            console.log(`${LOG_PREFIX} Skipping historical message: ${mesId}`);
        }

        // Add button to new message
        setTimeout(() => {
            addRefinementButtonToMessage(mesId);
        }, 100);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        messageCount = 0; // Reset counter on chat change
        // Add buttons to all messages in new chat
        setTimeout(() => {
            addRefinementButtons();
        }, 500);
    });

    // Add buttons when messages are updated (swipes, edits, etc.)
    eventSource.on(event_types.MESSAGE_UPDATED, (mesId) => {
        setTimeout(async () => {
            await addRefinementButtonToMessage(mesId);
        }, 250);
    });

    eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
        setTimeout(async () => {
            await addRefinementButtonToMessage(mesId);
        }, 250);
    });

    // Prompt Injection Lifecycle
    eventSource.on(event_types.GENERATION_STARTED, async () => {
        if (settings.enablePromptInjection) {
            // Existing static injection
            injectAntiSlopPrompt();

            // FIX #1 BONUS: Module C - Dynamic proactive injection
            // Update with latest overused phrases from Module B
            const overused = PassiveWatcher.getOverusedPhrases();
            if (overused.length > 0) {
                ProactiveInjector.updateOverusedPhrases(overused);

                // Try to inject (will be added to prompt if phrases detected)
                const context = getContext();
                const injected = await ProactiveInjector.injectInstructions(context);

                if (injected) {
                    console.log(`${LOG_PREFIX} ✓ Module C: Proactive injection added (${overused.length} phrases)`);
                } else {
                    console.log(`${LOG_PREFIX} Module C: Injection skipped (no phrases or injection failed)`);
                }
            } else {
                console.log(`${LOG_PREFIX} Module C: No overused phrases detected yet`);
            }
        }
    });

    eventSource.on(event_types.GENERATION_ENDED, () => {
        if (settings.enablePromptInjection) {
            removeAntiSlopPrompt();
        }
    });
});

// Helper to initialize connection dropdown
function initConnectionDropdown() {
    console.log('[AI-SlopFixer] Initializing connection profile dropdown...');
    const selectId = '#asf_connection_profile';

    // Strategy 1: Use ConnectionManagerRequestService (Preferred)
    try {
        if (typeof ConnectionManagerRequestService !== 'undefined') {
            console.log('[AI-SlopFixer] Using ConnectionManagerRequestService');
            ConnectionManagerRequestService.handleDropdown(
                selectId,
                settings.connectionProfile || '',
                async (profile) => {
                    settings.connectionProfile = profile?.id || '';
                    saveSettings();
                    console.log('[AI-SlopFixer] Profile selected:', settings.connectionProfile);
                }
            );
            return;
        }
    } catch (err) {
        console.warn('[AI-SlopFixer] ConnectionManagerRequestService failed:', err);
    }

    // Strategy 2: Manual Fallback (if Service fails or is undefined)
    console.log('[AI-SlopFixer] Using manual profile population fallback');
    try {
        const context = SillyTavern.getContext();
        const profiles = context?.extensionSettings?.connectionManager?.profiles;

        if (Array.isArray(profiles)) {
            const $select = $(selectId);
            $select.empty();
            $select.append('<option value="">Use main chat connection</option>');

            profiles.sort((a, b) => a.name.localeCompare(b.name)).forEach(p => {
                const option = `<option value="${p.id}">${p.name}</option>`;
                $select.append(option);
            });

            if (settings.connectionProfile) {
                $select.val(settings.connectionProfile);
            }

            // Manual change handler
            $select.on('change', function () {
                settings.connectionProfile = $(this).val();
                saveSettings();
            });
        }
    } catch (err) {
        console.error('[AI-SlopFixer] Manual profile population failed:', err);
    }
}
