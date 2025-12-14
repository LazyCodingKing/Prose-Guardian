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
     * Load regex rules from JSON file and merge with dynamic rules from settings
     * @param {String} rulesFilePath - Path to static rules JSON file
     * @param {Array} dynamicRules - Array of AI-generated rules from settings (optional)
     */
    async loadRules(rulesFilePath, dynamicRules = []) {
        let staticRules = [];

        if (rulesFilePath) {
            // Load static rules from file
            try {
                const response = await fetch(rulesFilePath);
                staticRules = await response.json();
                console.log(`[StaticFixer] Loaded ${staticRules.length} static rules from ${rulesFilePath}`);
            } catch (error) {
                console.error('[StaticFixer] Failed to load static rules:', error);
                staticRules = [];
            }
        }

        // Merge static + dynamic rules
        this.rules = [
            ...staticRules.map(r => ({ ...r, isStatic: true })),
            ...dynamicRules.filter(r => !r.disabled).map(r => ({ ...r, isStatic: false }))
        ];

        const dynamicCount = dynamicRules.filter(r => !r.disabled).length;
        console.log(`[StaticFixer] Total rules: ${this.rules.length} (${staticRules.length} static + ${dynamicCount} dynamic)`);
    }

    /**
     * Apply static replacements to text
     * @param {String} text - Input text to process
     * @returns {String} - Processed text with replacements applied
     */
    applyReplacements(text) {
        if (!text || !this.enabled) return text;

        let processedText = text;
        // Apply both static and dynamic rules (filter out disabled)
        const enabledRules = this.rules.filter(rule => !rule.disabled);

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
