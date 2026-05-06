class QuantityExtractor {
    constructor() {
        this.patterns = [
            { regex: /pack\s+of\s+(\d+)/i, multiplier: 1 },
            { regex: /(\d+)\s*pack/i, multiplier: 1 },
            { regex: /(\d+)\s*pcs/i, multiplier: 1 },
            { regex: /(\d+)\s*pieces/i, multiplier: 1 },
            { regex: /(\d+)\s*count/i, multiplier: 1 },
            { regex: /(\d+)\s*ct\b/i, multiplier: 1 },
            { regex: /set\s+of\s+(\d+)/i, multiplier: 1 },
            { regex: /(\d+)\s*set/i, multiplier: 1 },
            { regex: /(\d+)\s*units/i, multiplier: 1 },
            { regex: /(\d+)\s*box/i, multiplier: 1 },
            { regex: /(\d+)\s*rolls?/i, multiplier: 1 },
            { regex: /(\d+)\s*sheets?/i, multiplier: 1 },
            { regex: /(\d+)\s*bags?/i, multiplier: 1 },
            { regex: /(\d+)\s*bottles?/i, multiplier: 1 },
            { regex: /(\d+)\s*cans?/i, multiplier: 1 },
            { regex: /(\d+)\s*pairs?/i, multiplier: 2 },
            { regex: /(\d+)\s*x\s*(\d+)/i, multiplier: 'multiply' },
            { regex: /(\d+)\s*pk/i, multiplier: 1 },
            { regex: /multipack\s+(\d+)/i, multiplier: 1 },
            { regex: /bulk\s+(\d+)/i, multiplier: 1 },
            { regex: /(\d+)\s*value\s+pack/i, multiplier: 1 },
            { regex: /(\d+)\s*mega\s+pack/i, multiplier: 1 },
            { regex: /(\d+)\s*family\s+pack/i, multiplier: 1 },
        ];

        this.bulkKeywords = [
            'bulk', 'wholesale', 'multipack', 'multi-pack', 'value pack',
            'family pack', 'mega pack', 'economy pack', 'jumbo pack',
            'case of', 'carton', 'pallet'
        ];
    }

    extractQuantity(title, description = '') {
        const text = `${title} ${description}`.toLowerCase();
        
        for (const pattern of this.patterns) {
            const match = text.match(pattern.regex);
            if (match) {
                if (pattern.multiplier === 'multiply') {
                    const num1 = parseInt(match[1], 10);
                    const num2 = parseInt(match[2], 10);
                    return num1 * num2;
                } else {
                    const quantity = parseInt(match[1], 10);
                    return quantity * pattern.multiplier;
                }
            }
        }
        
        return null;
    }

    detectBulkKeywords(title, description = '') {
        const text = `${title} ${description}`.toLowerCase();
        
        for (const keyword of this.bulkKeywords) {
            if (text.includes(keyword)) {
                return true;
            }
        }
        
        return false;
    }

    estimateBulkStatus(title, description = '', price = null) {
        const quantity = this.extractQuantity(title, description);
        const hasBulkKeywords = this.detectBulkKeywords(title, description);
        
        let confidence = 0;
        let isBulk = false;
        
        if (quantity !== null) {
            if (quantity >= 100) {
                isBulk = true;
                confidence = 0.95;
            } else if (quantity >= 20) {
                isBulk = true;
                confidence = 0.80;
            } else if (quantity >= 5) {
                isBulk = true;
                confidence = 0.60;
            }
        }
        
        if (hasBulkKeywords) {
            isBulk = true;
            confidence = Math.max(confidence, 0.70);
        }
        
        if (quantity && quantity > 1 && hasBulkKeywords) {
            confidence = Math.min(confidence + 0.1, 1.0);
        }
        
        return {
            isBulk,
            quantity,
            confidence,
            needsAIVerification: confidence < 0.7 && (quantity !== null || hasBulkKeywords)
        };
    }

    normalizeQuantity(quantity) {
        if (!quantity || quantity < 1) return 1;
        if (quantity > 10000) return 10000;
        return Math.round(quantity);
    }
}

module.exports = new QuantityExtractor();
