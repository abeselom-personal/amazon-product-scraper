const config = require('../config/config');

class ScoringEngine {

    calculateShippingScore(product) {
        const shippable = product.ai_is_resale_pack_shippable_under_100g ?? product.ai_is_shippable_under_100g;
        const weight = product.ai_estimated_resale_pack_weight_grams ?? product.ai_estimated_weight_grams;
        const threshold = config.filters.maxShippableWeightGrams || 100;

        if (shippable === 1 || shippable === true) return 1.0;
        if (shippable === 0 || shippable === false) return 0.0;

        if (weight != null && !isNaN(weight)) {
            return Number(weight) <= threshold ? 1.0 : 0.0;
        }

        // Unknown weight gets a neutral middle score.
        return 0.5;
    }
    
    calculateBulkScore(product) {
        const quantity = product.quantity_estimate || 1;
        const isBulk = product.is_bulk;
        
        let score = 0;
        
        if (quantity >= config.scoring.bulkThresholds.high) {
            score = 1.0;
        } else if (quantity >= config.scoring.bulkThresholds.medium) {
            score = 0.7;
        } else if (quantity >= config.scoring.bulkThresholds.low) {
            score = 0.4;
        } else {
            score = 0.1;
        }
        
        if (isBulk && quantity > 1) {
            score = Math.min(score + 0.1, 1.0);
        }
        
        return score;
    }

    calculateDemandScore(product) {
        const reviewCount = product.review_count || 0;
        const rating = product.rating || 0;
        
        const logReviews = reviewCount > 0 ? Math.log10(reviewCount + 1) : 0;
        const maxLogReviews = Math.log10(10001);
        const reviewScore = Math.min(logReviews / maxLogReviews, 1.0);
        
        const ratingScore = rating > 0 ? (rating / 5.0) : 0;
        
        const demandScore = (reviewScore * 0.6) + (ratingScore * 0.4);
        
        return Math.max(0, Math.min(1, demandScore));
    }

    calculateTrustScore(product) {
        const rating = product.rating || 0;
        const reviewCount = product.review_count || 0;
        const primeEligible = product.prime_eligible || false;
        
        let score = 0;
        
        if (rating >= config.scoring.trustThresholds.minRating) {
            score += 0.4;
        } else if (rating >= 4.0) {
            score += 0.25;
        } else if (rating >= 3.5) {
            score += 0.1;
        }
        
        if (reviewCount >= config.scoring.trustThresholds.minReviews) {
            score += 0.4;
        } else if (reviewCount >= 50) {
            score += 0.25;
        } else if (reviewCount >= 10) {
            score += 0.1;
        }
        
        if (primeEligible) {
            score += 0.2;
        }
        
        return Math.max(0, Math.min(1, score));
    }

    calculateUnitMarginScore(product) {
        const price = product.price || 0;
        const quantity = product.quantity_estimate || 1;
        const category = product.category || 'misc';
        
        if (price <= 0 || quantity <= 0) {
            return 0;
        }
        
        const unitPrice = price / quantity;
        
        const multipliers = config.scoring.categoryMultipliers[category] || 
                          config.scoring.categoryMultipliers.misc;
        
        const estimatedResaleMin = unitPrice * multipliers.min;
        const estimatedResaleMax = unitPrice * multipliers.max;
        const estimatedResaleAvg = (estimatedResaleMin + estimatedResaleMax) / 2;
        
        const marginPerUnit = estimatedResaleAvg - unitPrice;
        const totalMargin = marginPerUnit * quantity;
        
        let score = 0;
        
        if (totalMargin >= 100) {
            score = 1.0;
        } else if (totalMargin >= 50) {
            score = 0.8;
        } else if (totalMargin >= 20) {
            score = 0.6;
        } else if (totalMargin >= 10) {
            score = 0.4;
        } else if (totalMargin >= 5) {
            score = 0.2;
        } else {
            score = 0.1;
        }
        
        const marginRatio = marginPerUnit / unitPrice;
        if (marginRatio >= 2.0) {
            score = Math.min(score + 0.1, 1.0);
        }
        
        return Math.max(0, Math.min(1, score));
    }

    calculateFinalScore(product) {
        const bulkScore = this.calculateBulkScore(product);
        const demandScore = this.calculateDemandScore(product);
        const trustScore = this.calculateTrustScore(product);
        const unitMarginScore = this.calculateUnitMarginScore(product);
        const shippingScore = this.calculateShippingScore(product);
        
        const weights = config.scoring.weights;
        
        const weightedCore = 
            (bulkScore * weights.bulk) +
            (demandScore * weights.demand) +
            (trustScore * weights.trust) +
            (unitMarginScore * weights.unitMargin);
        const finalScore = (weightedCore * 0.85) + (shippingScore * 0.15);
        
        return {
            bulk_score: Math.round(bulkScore * 1000) / 1000,
            demand_score: Math.round(demandScore * 1000) / 1000,
            trust_score: Math.round(trustScore * 1000) / 1000,
            unit_margin_score: Math.round(unitMarginScore * 1000) / 1000,
            shipping_score: Math.round(shippingScore * 1000) / 1000,
            final_score: Math.round(finalScore * 1000) / 1000
        };
    }

    scoreProduct(product) {
        const scores = this.calculateFinalScore(product);
        
        return {
            ...product,
            ...scores
        };
    }

    scoreBatch(products) {
        return products.map(product => this.scoreProduct(product));
    }

    rankProducts(products) {
        return products.sort((a, b) => {
            const scoreA = a.final_score || 0;
            const scoreB = b.final_score || 0;
            return scoreB - scoreA;
        });
    }

    getTopProducts(products, limit = 100) {
        const ranked = this.rankProducts([...products]);
        return ranked.slice(0, limit);
    }
}

module.exports = new ScoringEngine();
