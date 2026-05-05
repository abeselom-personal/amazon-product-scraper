const crypto = require('crypto');
const config = require('../config/config');

class DeduplicationEngine {
    
    normalizeTitle(title) {
        if (!title) return '';
        
        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    normalizeUrl(url) {
        if (!url) return '';
        
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            
            const asinMatch = pathname.match(/\/dp\/([A-Z0-9]{10})/i) || 
                            pathname.match(/\/gp\/product\/([A-Z0-9]{10})/i);
            
            if (asinMatch) {
                return `product:${asinMatch[1].toUpperCase()}`;
            }
            
            return pathname.toLowerCase().replace(/\/$/, '');
        } catch (e) {
            return url.toLowerCase();
        }
    }

    extractASIN(url) {
        if (!url) return null;
        
        const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || 
                         url.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
                         url.match(/\/ASIN\/([A-Z0-9]{10})/i);
        
        return asinMatch ? asinMatch[1].toUpperCase() : null;
    }

    calculateTitleSimilarity(title1, title2) {
        const norm1 = this.normalizeTitle(title1);
        const norm2 = this.normalizeTitle(title2);
        
        if (!norm1 || !norm2) return 0;
        
        const words1 = new Set(norm1.split(' '));
        const words2 = new Set(norm2.split(' '));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    arePricesSimilar(price1, price2, threshold = 0.05) {
        if (!price1 || !price2) return false;
        
        const diff = Math.abs(price1 - price2);
        const avg = (price1 + price2) / 2;
        
        return (diff / avg) <= threshold;
    }

    async findDuplicates(db, product, sourceRunId) {
        const duplicates = [];
        
        if (product.asin) {
            const existing = await db.get(
                'SELECT * FROM products WHERE asin = ? AND source_run_id != ?',
                [product.asin, sourceRunId]
            );
            
            if (existing) {
                duplicates.push({
                    product: existing,
                    matchType: 'asin',
                    confidence: 1.0
                });
                return duplicates;
            }
        }
        
        const normalizedUrl = this.normalizeUrl(product.url);
        if (normalizedUrl) {
            const existing = await db.get(
                'SELECT * FROM products WHERE normalized_url = ? AND source_run_id != ?',
                [normalizedUrl, sourceRunId]
            );
            
            if (existing) {
                duplicates.push({
                    product: existing,
                    matchType: 'url',
                    confidence: 0.95
                });
                return duplicates;
            }
        }
        
        const normalizedTitle = this.normalizeTitle(product.title);
        if (normalizedTitle) {
            const recentProducts = await db.all(
                `SELECT * FROM products 
                 WHERE normalized_title LIKE ? 
                 AND datetime(last_seen_at) > datetime('now', '-${config.database.deduplicationTTL / (24 * 60 * 60 * 1000)} days')
                 AND source_run_id != ?
                 LIMIT 50`,
                [`%${normalizedTitle.split(' ').slice(0, 3).join('%')}%`, sourceRunId]
            );
            
            for (const existing of recentProducts) {
                const titleSimilarity = this.calculateTitleSimilarity(
                    product.title,
                    existing.title
                );
                
                if (titleSimilarity > 0.8) {
                    const priceMatch = this.arePricesSimilar(product.price, existing.price);
                    
                    if (priceMatch || titleSimilarity > 0.95) {
                        const confidence = priceMatch ? 
                            Math.min(titleSimilarity + 0.1, 1.0) : 
                            titleSimilarity;
                        
                        duplicates.push({
                            product: existing,
                            matchType: 'title_price',
                            confidence
                        });
                    }
                }
            }
        }
        
        duplicates.sort((a, b) => b.confidence - a.confidence);
        return duplicates.slice(0, 1);
    }

    async checkDuplicateInCurrentRun(db, product, sourceRunId) {
        const normalizedUrl = this.normalizeUrl(product.url);
        
        const existing = await db.get(
            'SELECT id FROM products WHERE source_run_id = ? AND normalized_url = ?',
            [sourceRunId, normalizedUrl]
        );
        
        return existing !== undefined;
    }

    async logDeduplication(db, productId, duplicateOfId, matchType, confidence) {
        await db.run(
            `INSERT INTO deduplication_log (product_id, duplicate_of_id, match_type, match_confidence)
             VALUES (?, ?, ?, ?)`,
            [productId, duplicateOfId, matchType, confidence]
        );
    }

    generateProductFingerprint(product) {
        const data = `${product.title}|${product.price}|${product.url}`;
        return crypto.createHash('md5').update(data).digest('hex');
    }
}

module.exports = new DeduplicationEngine();
