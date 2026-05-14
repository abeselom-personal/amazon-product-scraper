/**
 * Dimension and Weight Extractor
 * Extracts weight, dimensions, and size information from product descriptions
 */

class DimensionExtractor {
    constructor() {
        // Weight patterns (grams, kg, lbs, oz)
        this.weightPatterns = [
            // Grams
            /(\d+(?:\.\d+)?)\s*(?:g|grams?|gramme)/gi,
            // Kilograms
            /(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|kilogramme)/gi,
            // Pounds
            /(\d+(?:\.\d+)?)\s*(?:lb|lbs?|pounds?)/gi,
            // Ounces
            /(\d+(?:\.\d+)?)\s*(?:oz|ounces?)/gi,
            // Combined (e.g., "500g", "2.5kg")
            /(\d+(?:\.\d+)?)\s*(g|kg|lb|oz)/gi,
        ];

        // Dimension patterns (length x width x height)
        this.dimensionPatterns = [
            // Metric: cm, mm, m
            /(\d+(?:\.\d+)?)\s*(?:cm|centimetres?|centimeters?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|centimetres?|centimeters?)\s*(?:[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|centimetres?|centimeters?))?/gi,
            /(\d+(?:\.\d+)?)\s*(?:mm|millimetres?|millimeters?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimetres?|millimeters?)\s*(?:[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm|millimetres?|millimeters?))?/gi,
            // Imperial: inches
            /(\d+(?:\.\d+)?)\s*(?:in|inch|inches?|")\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches?|")\s*(?:[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inch|inches?|"))?/gi,
            // Combined with units
            /(\d+(?:\.\d+)?)\s*(?:cm|mm|in|x|×)\s*(\d+(?:\.\d+)?)\s*(?:cm|mm|in|x|×)\s*(\d+(?:\.\d+)?)\s*(?:cm|mm|in)?/gi,
        ];

        // Size patterns (small, medium, large, etc.)
        this.sizePatterns = [
            /\b(small|medium|large|x-large|xl|xxl|xs|s|m|l)\b/gi,
        ];
    }

    extractWeight(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }

        const results = [];
        let match;

        // Try each weight pattern
        for (const pattern of this.weightPatterns) {
            pattern.lastIndex = 0; // Reset regex
            while ((match = pattern.exec(text)) !== null) {
                const value = parseFloat(match[1]);
                const unit = match[2] || this.inferUnitFromContext(text, match.index);

                if (unit && !isNaN(value)) {
                    const grams = this.convertToGrams(value, unit);
                    if (grams > 0) {
                        results.push({
                            value,
                            unit,
                            grams,
                            text: match[0],
                            index: match.index
                        });
                    }
                }
            }
        }

        // Return the most likely weight (largest value for grams)
        if (results.length > 0) {
            results.sort((a, b) => b.grams - a.grams);
            return results[0];
        }

        return null;
    }

    extractDimensions(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }

        const results = [];
        let match;

        // Try each dimension pattern
        for (const pattern of this.dimensionPatterns) {
            pattern.lastIndex = 0; // Reset regex
            while ((match = pattern.exec(text)) !== null) {
                const length = parseFloat(match[1]);
                const width = parseFloat(match[2]);
                const height = match[3] ? parseFloat(match[3]) : null;

                if (!isNaN(length) && !isNaN(width)) {
                    results.push({
                        length,
                        width,
                        height,
                        text: match[0],
                        index: match.index,
                        unit: this.inferDimensionUnit(text, match.index)
                    });
                }
            }
        }

        // Return the most likely dimensions (first match)
        if (results.length > 0) {
            return results[0];
        }

        return null;
    }

    extractSize(text) {
        if (!text || typeof text !== 'string') {
            return null;
        }

        const results = [];
        let match;

        // Try each size pattern
        for (const pattern of this.sizePatterns) {
            pattern.lastIndex = 0; // Reset regex
            while ((match = pattern.exec(text)) !== null) {
                results.push({
                    size: match[1].toLowerCase(),
                    text: match[0],
                    index: match.index
                });
            }
        }

        // Return the first size found
        if (results.length > 0) {
            return results[0];
        }

        return null;
    }

    extractAll(text) {
        return {
            weight: this.extractWeight(text),
            dimensions: this.extractDimensions(text),
            size: this.extractSize(text)
        };
    }

    convertToGrams(value, unit) {
        const unitLower = unit.toLowerCase();
        
        switch (unitLower) {
            case 'g':
            case 'grams':
            case 'gram':
            case 'gramme':
                return value;
            case 'kg':
            case 'kilograms':
            case 'kilogram':
            case 'kilogramme':
                return value * 1000;
            case 'lb':
            case 'lbs':
            case 'pound':
            case 'pounds':
                return value * 453.592;
            case 'oz':
            case 'ounces':
                return value * 28.3495;
            default:
                return value; // Assume grams if unknown
        }
    }

    inferUnitFromContext(text, index) {
        // Look for unit indicators near the match
        const context = text.substring(Math.max(0, index - 20), Math.min(text.length, index + 20));
        
        if (context.includes('kg') || context.includes('kilogram')) return 'kg';
        if (context.includes('lb') || context.includes('pound')) return 'lb';
        if (context.includes('oz') || context.includes('ounce')) return 'oz';
        
        return 'g'; // Default to grams
    }

    inferDimensionUnit(text, index) {
        // Look for unit indicators near the match
        const context = text.substring(Math.max(0, index - 20), Math.min(text.length, index + 20));
        
        if (context.includes('mm') || context.includes('millimeter')) return 'mm';
        if (context.includes('in') || context.includes('inch') || context.includes('"')) return 'in';
        
        return 'cm'; // Default to cm
    }

    validateExtraction(extraction, product) {
        const validation = {
            weight: { found: false, confidence: 0, source: '' },
            dimensions: { found: false, confidence: 0, source: '' },
            size: { found: false, confidence: 0, source: '' }
        };

        if (extraction.weight) {
            validation.weight.found = true;
            validation.weight.confidence = 0.7; // Medium confidence for regex extraction
            validation.weight.source = 'description';
        }

        if (extraction.dimensions) {
            validation.dimensions.found = true;
            validation.dimensions.confidence = 0.6; // Lower confidence for dimensions
            validation.dimensions.source = 'description';
        }

        if (extraction.size) {
            validation.size.found = true;
            validation.size.confidence = 0.5; // Lowest confidence for size
            validation.size.source = 'description';
        }

        return validation;
    }
}

module.exports = new DimensionExtractor();
