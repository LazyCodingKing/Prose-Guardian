/**
 * MODULE A: Static Fixer (Zero-Token Correction)
 * Ported from ProsePolisher for AI-SlopFixer
 * 
 * This module provides instant, client-side text replacement using regex patterns
 * with randomized alternatives. No API calls required.
 */

export class StaticFixer {
    constructor() {
        this.rules = [];
        this.enabled = true;
    }

    /**
     * Load regex rules from a JSON file or array
     * @param {Array|String} rulesSource - Array of rule objects or path to JSON file
     */
    async loadRules(rulesSource) {
        if (typeof rulesSource === 'string') {
            // Load from file path
            try {
                const response = await fetch(rulesSource);
                this.rules = await response.json();
                console.log(`[StaticFixer] Loaded ${this.rules.length} rules from ${rulesSource}`);
            } catch (error) {
                console.error('[StaticFixer] Failed to load rules:', error);
                this.rules = [];
            }
        } else if (Array.isArray(rulesSource)) {
            // Direct array of rules
            this.rules = rulesSource;
            console.log(`[StaticFixer] Loaded ${this.rules.length} rules from array`);
        }
    }

    /**
     * Apply static replacements to text
     * @param {String} text - Input text to process
     * @returns {String} - Processed text with replacements applied
     */
    applyReplacements(text) {
        if (!text || !this.enabled) return text;

        let processedText = text;
        const enabledRules = this.rules.filter(rule => !rule.disabled && rule.isStatic);

        enabledRules.forEach(rule => {
            try {
                // Compile regex with global and case-insensitive flags
                const regex = new RegExp(rule.findRegex, 'gi');

                if (rule.replaceString.includes('{{random:')) {
                    // Parse {{random:option1,option2,...}} syntax
                    const optionsMatch = rule.replaceString.match(/\{\{random:([\s\S]+?)\}\}/);
                    if (optionsMatch && optionsMatch[1]) {
                        const options = optionsMatch[1].split(',');

                        processedText = processedText.replace(regex, (match, ...args) => {
                            // Pick random option
                            const chosenOption = options[Math.floor(Math.random() * options.length)].trim();

                            // Replace backreferences ($1, $2, etc.) with captured groups
                            return chosenOption.replace(/\$(\d)/g, (_, groupIndex) => {
                                return args[parseInt(groupIndex) - 1] || '';
                            });
                        });
                    }
                } else {
                    // Simple string replacement
                    processedText = processedText.replace(regex, rule.replaceString);
                }
            } catch (error) {
                console.warn(`[StaticFixer] Invalid regex in rule '${rule.scriptName}':`, error);
            }
        });

        return processedText;
    }

    /**
     * Fix sentence capitalization after replacements
     * Handles HTML tags gracefully
     * @param {String} text - Text to capitalize
     * @returns {String} - Text with proper capitalization
     */
    fixCapitalization(text) {
        if (!text) return text;

        let fixed = text;

        // Capitalize first letter (handling HTML tags)
        fixed = fixed.replace(/^(\s*<[^>]*>)*([a-z])/s, (match, tags, letter) => {
            return `${tags || ''}${letter.toUpperCase()}`;
        });

        // Capitalize after sentence endings
        fixed = fixed.replace(/([.!?])(\s*<[^>]*>)*\s+([a-z])/gs, (match, punc, tags, letter) => {
            return `${punc}${tags || ''} ${letter.toUpperCase()}`;
        });

        return fixed;
    }

    /**
     * Process text - apply replacements and fix capitalization
     * @param {String} text - Input text
     * @returns {String} - Processed text
     */
    process(text) {
        let processed = this.applyReplacements(text);
        processed = this.fixCapitalization(processed);
        return processed;
    }

    /**
     * Get statistics about loaded rules
     * @returns {Object} - Rule statistics
     */
    getStats() {
        const total = this.rules.length;
        const enabled = this.rules.filter(r => !r.disabled).length;
        const disabled = total - enabled;

        return {
            total,
            enabled,
            disabled,
            categories: this.getCategoryBreakdown()
        };
    }

    /**
     * Get breakdown of rules by category
     * @returns {Object} - Category counts
     */
    getCategoryBreakdown() {
        const categories = {};
        this.rules.forEach(rule => {
            const category = rule.category || 'Uncategorized';
            categories[category] = (categories[category] || 0) + 1;
        });
        return categories;
    }

    /**
     * Enable or disable a specific rule by ID
     * @param {String} ruleId - Rule ID to modify
     * @param {Boolean} enabled - Enable or disable
     */
    setRuleEnabled(ruleId, enabled) {
        const rule = this.rules.find(r => r.id === ruleId);
        if (rule) {
            rule.disabled = !enabled;
        }
    }

    /**
     * Enable or disable all rules
     * @param {Boolean} enabled - Enable or disable all rules
     */
    setAllRulesEnabled(enabled) {
        this.rules.forEach(rule => {
            rule.disabled = !enabled;
        });
    }
}

// Export default instance for convenience
export default new StaticFixer();
