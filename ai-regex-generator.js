// ==========================
// AI Regex Generator (Module D)
// ==========================
// Automatically generates regex rules from detected patterns using AI

const LOG_PREFIX = '[Prose-Guardian:AI-Generator]';

export class AIRegexGenerator {
    constructor(settings, saveSettingsCallback, showNotification) {
        this.settings = settings;
        this.saveSettings = saveSettingsCallback;
        this.showNotification = showNotification;
        this.isGenerating = false;
    }

    /**
     * Main entry point: Generate regex rules from detected phrases
     * @param {Array} phrases - Array of {phrase, score, count} from Passive Watcher
     * @returns {Promise<number>} Number of rules generated
     */
    async generateRulesFromPhrases(phrases) {
        if (this.isGenerating) {
            console.warn(`${LOG_PREFIX} Generation already in progress`);
            this.showNotification('Rule generation already in progress', 'warning');
            return 0;
        }

        if (!phrases || phrases.length === 0) {
            console.warn(`${LOG_PREFIX} No phrases to process`);
            this.showNotification('No patterns detected to generate rules from', 'info');
            return 0;
        }

        this.isGenerating = true;
        const MIN_ALTERNATIVES = 15;
        const BATCH_SIZE = 10; // Process 10 phrases at a time
        let totalGenerated = 0;

        try {
            // Process in batches to avoid overwhelming the AI
            for (let i = 0; i < phrases.length; i += BATCH_SIZE) {
                const batch = phrases.slice(i, Math.min(i + BATCH_SIZE, phrases.length));
                console.log(`${LOG_PREFIX} Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} phrases)`);

                const prompt = this.buildGenerationPrompt(batch, MIN_ALTERNATIVES);

                try {
                    // Use SillyTavern's generation API
                    const response = await this.callAI(prompt);
                    const newRules = this.parseAndValidateRules(response, MIN_ALTERNATIVES);

                    if (newRules.length > 0) {
                        this.saveRulesToSettings(newRules);
                        totalGenerated += newRules.length;
                        console.log(`${LOG_PREFIX} Batch generated ${newRules.length} valid rules`);
                    }
                } catch (error) {
                    console.error(`${LOG_PREFIX} Error processing batch:`, error);
                    this.showNotification(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`, 'error');
                }
            }

            if (totalGenerated > 0) {
                this.showNotification(`✨ Generated ${totalGenerated} new regex rules!`, 'success');
                console.log(`${LOG_PREFIX} Total rules generated: ${totalGenerated}`);
            } else {
                this.showNotification('No valid rules could be generated', 'warning');
            }

        } catch (error) {
            console.error(`${LOG_PREFIX} Generation failed:`, error);
            this.showNotification(`Rule generation failed: ${error.message}`, 'error');
        } finally {
            this.isGenerating = false;
        }

        return totalGenerated;
    }

    /**
     * Build optimized AI prompt for regex generation
     */
    buildGenerationPrompt(phrases, minAlternatives) {
        const phraseList = phrases.map((p, idx) =>
            `${idx + 1}. "${p.phrase}" (detected ${p.count} times, score: ${p.score.toFixed(1)})`
        ).join('\n');

        return `You are a regex pattern expert for a prose quality extension. Your task is to create professional regex replacement rules for overused AI writing patterns.

**Detected Overused Phrases:**
${phraseList}

**Your Task:**
For EACH phrase above, create a JSON rule object with:

1. **findRegex**: A flexible regex pattern that captures variations
   - Use word boundaries (\\\\b) appropriately
   - Add capture groups ((...)) for pronouns like (his|her|their)
   - Make it match similar variations of the phrase
   - Example: \`\\\\b([Hh]is|[Hh]er|[Tt]heir)\\\\s+heart\\\\s+(raced|pounded|hammered)\\\\b\`

2. **replaceString**: A list of ${minAlternatives}+ creative alternatives in {{random:...}} format
   - MUST be exactly: \`{{random:alt1,alt2,alt3,...,alt${minAlternatives}}}\`
   - Use $1, $2 for capture group replacements
   - Each alternative must be grammatically correct
   - Vary sentence structure, word choice, intensity
   - Example: \`{{random:$1 pulse quickened,$1 chest tightened,$1 heart slammed against $1 ribs}}\`

3. **scriptName**: Brief descriptive name (e.g., "Slopfix - Heart Racing")

**Critical Requirements:**
- At least ${minAlternatives} unique alternatives per rule
- Alternatives separated by COMMAS (,) NOT pipes (|)
- Alternatives must fit the capture groups
- Regex must be valid JavaScript regex
- Output ONLY a JSON array, nothing else

**Example Output:**
\`\`\`json
[
  {
    "scriptName": "Slopfix - Heart Racing",
    "findRegex": "\\\\b([Hh]is|[Hh]er|[Tt]heir)\\\\s+heart\\\\s+(raced|pounded|hammered)\\\\b",
    "replaceString": "{{random:$1 pulse quickened,$1 chest tightened with a

 heavy thudding,$1 heartbeat echoed in $1 ears,$1 heart slammed against $1 ribs,a frantic rhythm drummed against $1 ribs,something battled for escape within $1 ribcage,$1 pulse hammered at the base of $1 throat,a wild rhythm seized $1 chest,each pulse battered $1 chest as if desperate to escape,a nervous tremor started beneath $1 breastbone,a sudden violent jolt vibrated through $1 chest,an unsettling quickening started beneath $1 ribs,the heavy cadence of $1 heart filled $1 ears,a racing staccato took over where calm had lived,a wild percussion shook $1 focus loose}}"
  }
]
\`\`\`

Generate the JSON array now:`;
    }

    /**
     * Call SillyTavern's AI generation API
     */
    async callAI(prompt) {
        // Import SillyTavern's generation functions
        const { generateQuietPrompt } = await import('../../../../script.js');

        console.log(`${LOG_PREFIX} Calling AI for rule generation...`);

        const response = await generateQuietPrompt(prompt, false, false);

        if (!response || !response.trim()) {
            throw new Error('AI returned empty response');
        }

        console.log(`${LOG_PREFIX} AI response received (${response.length} chars)`);
        return response;
    }

    /**
     * Parse and validate AI-generated rules
     */
    parseAndValidateRules(response, minAlternatives) {
        const rules = [];

        try {
            // Extract JSON from potential markdown code blocks
            const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```|(\[[\s\S]*?\])/);
            const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[2]) : response;

            const parsed = JSON.parse(jsonString);
            const rulesArray = Array.isArray(parsed) ? parsed : [parsed];

            for (const rule of rulesArray) {
                // Validate required fields
                if (!rule.scriptName || !rule.findRegex || !rule.replaceString) {
                    console.warn(`${LOG_PREFIX} Rule missing required fields:`, rule);
                    continue;
                }

                // Validate regex compiles
                try {
                    new RegExp(rule.findRegex);
                } catch (e) {
                    console.warn(`${LOG_PREFIX} Invalid regex for "${rule.scriptName}": ${e.message}`);
                    continue;
                }

                // Validate replaceString format and count alternatives
                const match = rule.replaceString.match(/^{{random:(.+)}}$/);
                if (!match) {
                    console.warn(`${LOG_PREFIX} Invalid replaceString format for "${rule.scriptName}"`);
                    continue;
                }

                const alternatives = match[1].split(',').map(s => s.trim()).filter(s => s);
                if (alternatives.length < minAlternatives) {
                    console.warn(`${LOG_PREFIX} Insufficient alternatives for "${rule.scriptName}": ${alternatives.length}/${minAlternatives}`);
                    continue;
                }

                // Add metadata
                rule.id = `AI_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                rule.disabled = false;
                rule.isStatic = false;
                rule.isAI = true; // Mark as AI-generated

                rules.push(rule);
                console.log(`${LOG_PREFIX} ✓ Validated rule: "${rule.scriptName}" (${alternatives.length} alternatives)`);
            }

        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to parse AI response:`, error);
            console.log(`${LOG_PREFIX} Raw response:`, response.substring(0, 500));
            throw new Error(`Failed to parse AI response: ${error.message}`);
        }

        return rules;
    }

    /**
     * Save generated rules to settings
     */
    saveRulesToSettings(newRules) {
        if (!this.settings.dynamicRules) {
            this.settings.dynamicRules = [];
        }

        this.settings.dynamicRules.push(...newRules);
        this.saveSettings();

        console.log(`${LOG_PREFIX} Saved ${newRules.length} rules to settings (total dynamic rules: ${this.settings.dynamicRules.length})`);
    }

    /**
     * Get all dynamic (AI-generated) rules
     */
    getDynamicRules() {
        return this.settings.dynamicRules || [];
    }

    /**
     * Clear all AI-generated rules
     */
    clearDynamicRules() {
        this.settings.dynamicRules = [];
        this.saveSettings();
        console.log(`${LOG_PREFIX} Cleared all dynamic rules`);
    }

    /**
     * Manually add a single rule
     * @param {Object} rule - Rule object {scriptName, findRegex, replaceString}
     * @returns {Boolean} Success
     */
    addRule(rule) {
        try {
            // Validate
            if (!rule.scriptName || !rule.findRegex || !rule.replaceString) {
                throw new Error('Rule missing required fields');
            }

            // Validate regex
            new RegExp(rule.findRegex);

            // Add metadata
            rule.id = `MANUAL_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            rule.disabled = rule.disabled ?? false;
            rule.isStatic = false;
            rule.isManual = true;

            if (!this.settings.dynamicRules) {
                this.settings.dynamicRules = [];
            }

            this.settings.dynamicRules.push(rule);
            this.saveSettings();

            console.log(`${LOG_PREFIX} Manually added rule: "${rule.scriptName}"`);
            return true;
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to add rule:`, error);
            this.showNotification(`Failed to add rule: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Edit existing rule
     * @param {String} ruleId - Rule ID to edit
     * @param {Object} updates - Updated rule properties
     * @returns {Boolean} Success
     */
    editRule(ruleId, updates) {
        try {
            const rules = this.settings.dynamicRules || [];
            const index = rules.findIndex(r => r.id === ruleId);

            if (index === -1) {
                throw new Error('Rule not found');
            }

            // Validate regex if changed
            if (updates.findRegex) {
                new RegExp(updates.findRegex);
            }

            // Update fields
            Object.assign(rules[index], updates);
            this.saveSettings();

            console.log(`${LOG_PREFIX} Edited rule: "${rules[index].scriptName}"`);
            return true;
        } catch (error) {
            console.error(`${LOG_PREFIX} Failed to edit rule:`, error);
            this.showNotification(`Failed to edit rule: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Delete rule
     * @param {String} ruleId - Rule ID to delete
     * @returns {Boolean} Success
     */
    deleteRule(ruleId) {
        const rules = this.settings.dynamicRules || [];
        const index = rules.findIndex(r => r.id === ruleId);

        if (index === -1) {
            console.warn(`${LOG_PREFIX} Rule not found: ${ruleId}`);
            return false;
        }

        const deleted = rules.splice(index, 1)[0];
        this.saveSettings();

        console.log(`${LOG_PREFIX} Deleted rule: "${deleted.scriptName}"`);
        return true;
    }

    /**
     * Export dynamic rules to JSON file
     * @returns {String} JSON string
     */
    exportRules() {
        const rules = this.settings.dynamicRules || [];
        if (rules.length === 0) {
            this.showNotification('No dynamic rules to export', 'warning');
            return null;
        }

        const exportData = {
            version: '1.0',
            exported: new Date().toISOString(),
            rules: rules
        };

        const json = JSON.stringify(exportData, null, 2);
        console.log(`${LOG_PREFIX} Exported ${rules.length} dynamic rules`);
        return json;
    }

    /**
     * Import dynamic rules from JSON
     * @param {String} json - JSON string
     * @returns {Number} Number of rules imported
     */
    importRules(json) {
        try {
            const data = JSON.parse(json);
            const imported = data.rules || data; // Support both formats

            if (!Array.isArray(imported)) {
                throw new Error('Invalid format: expected array of rules');
            }

            let validCount = 0;
            const existingRules = this.settings.dynamicRules || [];

            for (const rule of imported) {
                // Validate required fields
                if (!rule.scriptName || !rule.findRegex || !rule.replaceString) {
                    console.warn(`${LOG_PREFIX} Skipping invalid rule:`, rule);
                    continue;
                }

                // Validate regex
                try {
                    new RegExp(rule.findRegex);
                } catch (e) {
                    console.warn(`${LOG_PREFIX} Skipping rule with invalid regex: "${rule.scriptName}"`);
                    continue;
                }

                // Check for duplicates
                const isDuplicate = existingRules.some(r =>
                    r.findRegex === rule.findRegex && r.replaceString === rule.replaceString
                );

                if (isDuplicate) {
                    console.warn(`${LOG_PREFIX} Skipping duplicate rule: "${rule.scriptName}"`);
                    continue;
                }

                // Add metadata
                rule.id = `IMP_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                rule.disabled = rule.disabled ?? false;
                rule.isStatic = false;
                rule.isImported = true;

                existingRules.push(rule);
                validCount++;
            }

            if (validCount > 0) {
                this.settings.dynamicRules = existingRules;
                this.saveSettings();
                this.showNotification(`✨ Imported ${validCount} rules!`, 'success');
            } else {
                this.showNotification('No valid rules found in file', 'warning');
            }

            console.log(`${LOG_PREFIX} Imported ${validCount} rules`);
            return validCount;
        } catch (error) {
            console.error(`${LOG_PREFIX} Import failed:`, error);
            this.showNotification(`Import failed: ${error.message}`, 'error');
            return 0;
        }
    }
}
