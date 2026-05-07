const db = require('../database/db');
const deduplication = require('./deduplication');
const quantityExtractor = require('./quantity-extractor');
const aiClassifier = require('./ai-classifier');
const scoringEngine = require('./scoring-engine');
const config = require('../config/config');

function safeParseJSON(s, fallback) {
    if (s == null) return fallback;
    if (typeof s === 'object') return s;
    try { return JSON.parse(s); } catch (e) { return fallback; }
}

class DataStorage {

    buildPriceFilterWhere(alias = '') {
        const f = config.filters;
        const prefix = alias ? `${alias}.` : '';
        const clauses = [];
        const params = [];

        if (f.enableMinimumPrice) {
            clauses.push(`${prefix}price >= ?`);
            params.push(f.minimumPriceGBP);
        }
        if (f.enableMaximumPrice) {
            clauses.push(`${prefix}price <= ?`);
            params.push(f.maximumPriceGBP);
        }

        if (!clauses.length) return { sql: '', params: [] };
        return { sql: ` AND ${clauses.join(' AND ')}`, params };
    }

    checkPriceFilter(product) {
        const f = config.filters;
        const minOn = f.enableMinimumPrice;
        const maxOn = f.enableMaximumPrice;
        if (!minOn && !maxOn) return null;

        const price = product.price;
        if (price == null) {
            // No price detected — only skip if at least one filter is on
            return { reason: 'no price detected' };
        }
        if (minOn && Number(price) < f.minimumPriceGBP) {
            return { reason: `price £${price} < min £${f.minimumPriceGBP}` };
        }
        if (maxOn && Number(price) > f.maximumPriceGBP) {
            return { reason: `price £${price} > max £${f.maximumPriceGBP}` };
        }
        return null;
    }

    async saveProduct(product, sourceRunId) {
        // Validate URL - reject invalid URLs to prevent constraint errors
        if (!product.url || product.url === '#' || product.url.endsWith('#') || !product.url.includes('/dp/')) {
            console.log(`[STORAGE] Skipping product with invalid URL: ${product.url}`);
            return { action: 'skipped_invalid_url', productId: null, reason: 'Invalid URL' };
        }

        const priceFail = this.checkPriceFilter(product);
        if (priceFail) {
            return { action: 'skipped_price_filter', productId: null, reason: priceFail.reason };
        }

        const isDuplicateInRun = await deduplication.checkDuplicateInCurrentRun(
            db, 
            product, 
            sourceRunId
        );

        if (isDuplicateInRun) {
            console.log(`[STORAGE] Skipping duplicate in current run: ${product.title?.substring(0, 50)}`);
            return { action: 'skipped_duplicate_in_run', productId: null };
        }

        const duplicates = await deduplication.findDuplicates(db, product, sourceRunId);

        if (duplicates.length > 0) {
            const duplicate = duplicates[0];
            console.log(`[STORAGE] Found duplicate (${duplicate.matchType}, confidence: ${duplicate.confidence}): ${product.title?.substring(0, 50)}`);
            
            await this.updateExistingProduct(duplicate.product.id, product, sourceRunId);
            
            return { 
                action: 'updated', 
                productId: duplicate.product.id,
                matchType: duplicate.matchType,
                confidence: duplicate.confidence
            };
        }

        const productId = await this.insertNewProduct(product, sourceRunId);
        
        return { action: 'inserted', productId };
    }

    async insertNewProduct(product, sourceRunId) {
        const normalizedTitle = deduplication.normalizeTitle(product.title);
        const normalizedUrl = deduplication.normalizeUrl(product.url);
        const imagesJson = JSON.stringify(Array.isArray(product.images) && product.images.length ? product.images : (product.image_url ? [product.image_url] : []));

        const result = await db.run(
            `INSERT INTO products (
                asin, title, normalized_title, price, rating, review_count,
                url, normalized_url, image_url, images, description, region, prime_eligible,
                source_run_id, source_category, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [
                product.asin,
                product.title,
                normalizedTitle,
                product.price,
                product.rating,
                product.review_count || 0,
                product.url,
                normalizedUrl,
                product.image_url,
                imagesJson,
                product.description || null,
                product.region,
                product.prime_eligible ? 1 : 0,
                sourceRunId,
                product.source_category || null
            ]
        );

        console.log(`[STORAGE] Inserted new product: ${product.title?.substring(0, 50)} (ID: ${result.lastID})`);
        
        return result.lastID;
    }

    async updateExistingProduct(productId, newData, sourceRunId) {
        // Merge image arrays without losing previously-seen images
        const existing = await db.get('SELECT images FROM products WHERE id = ?', [productId]);
        const existingImages = safeParseJSON(existing?.images, []);
        const incomingImages = Array.isArray(newData.images) ? newData.images : (newData.image_url ? [newData.image_url] : []);
        const merged = Array.from(new Set([...(incomingImages || []), ...(existingImages || [])])).slice(0, config.productDetail.maxImagesPerProduct);
        const imagesJson = JSON.stringify(merged);

        await db.run(
            `UPDATE products SET
                price = COALESCE(?, price),
                rating = COALESCE(?, rating),
                review_count = COALESCE(?, review_count),
                image_url = COALESCE(?, image_url),
                images = ?,
                description = COALESCE(?, description),
                source_category = COALESCE(?, source_category),
                prime_eligible = COALESCE(?, prime_eligible),
                last_seen_at = datetime('now')
            WHERE id = ?`,
            [
                newData.price,
                newData.rating,
                newData.review_count,
                newData.image_url,
                imagesJson,
                newData.description || null,
                newData.source_category || null,
                newData.prime_eligible ? 1 : 0,
                productId
            ]
        );

        console.log(`[STORAGE] Updated existing product ID: ${productId}`);
    }

    async enrichProduct(productId) {
        const product = await db.get('SELECT * FROM products WHERE id = ?', [productId]);
        
        if (!product) {
            throw new Error(`Product not found: ${productId}`);
        }

        product.images = safeParseJSON(product.images, []);

        const bulkAnalysis = quantityExtractor.estimateBulkStatus(
            product.title,
            '',
            product.price
        );

        // Always run AI for the new validation pipeline (Google AI Studio).
        // Heuristic only used as fallback merge.
        const aiClassification = await aiClassifier.classifyProduct(product);

        const quantity = aiClassification?.quantity ?? bulkAnalysis.quantity ?? null;
        const isBulk = aiClassification?.is_bulk ?? bulkAnalysis.isBulk;
        const category = aiClassification?.category || 'misc';
        const aiConfidence = aiClassification?.confidence ?? bulkAnalysis.confidence ?? 0.5;
        const resaleSuitability = aiClassification?.resale_suitability || 'medium';
        const isResellable = aiClassification?.is_resellable ?? false;
        const estimatedTotalWeightGrams = aiClassification?.estimated_total_weight_grams ?? null;
        const estimatedUnitWeightGrams = aiClassification?.estimated_unit_weight_grams ?? null;
        const recommendedResalePackQuantity = aiClassification?.recommended_resale_pack_quantity ?? null;
        const estimatedResalePackWeightGrams = aiClassification?.estimated_resale_pack_weight_grams ?? aiClassification?.estimated_weight_grams ?? null;
        const isResalePackShippableUnder100g = aiClassification?.is_resale_pack_shippable_under_100g ?? aiClassification?.is_shippable_under_100g;

        const enrichedProduct = {
            ...product,
            quantity_estimate: quantity,
            is_bulk: isBulk,
            category: category,
            ai_confidence_score: aiConfidence,
            resale_suitability: resaleSuitability,
            ai_classification: aiClassification ? JSON.stringify(aiClassification) : null,
            ai_notes: aiClassification?.notes || null,
            ai_summary: aiClassification?.summary || null,
            ai_signals: aiClassification?.signals ? JSON.stringify(aiClassification.signals) : null,
            ai_is_resellable: isResellable ? 1 : 0,
            ai_estimated_total_weight_grams: estimatedTotalWeightGrams,
            ai_estimated_unit_weight_grams: estimatedUnitWeightGrams,
            ai_recommended_resale_pack_quantity: recommendedResalePackQuantity,
            ai_estimated_resale_pack_weight_grams: estimatedResalePackWeightGrams,
            ai_is_resale_pack_shippable_under_100g: isResalePackShippableUnder100g == null ? null : (isResalePackShippableUnder100g ? 1 : 0),
            // Backward compatibility for existing API/UI/export paths
            ai_estimated_weight_grams: estimatedResalePackWeightGrams,
            ai_is_shippable_under_100g: isResalePackShippableUnder100g == null ? null : (isResalePackShippableUnder100g ? 1 : 0),
            ai_provider: aiClassification?.ai_provider || null,
        };

        const unitPrice = product.price && quantity > 0 ? product.price / quantity : null;
        enrichedProduct.unit_price = unitPrice;

        const scores = scoringEngine.calculateFinalScore(enrichedProduct);

        await db.run(
            `UPDATE products SET
                quantity_estimate = ?,
                is_bulk = ?,
                category = ?,
                ai_confidence_score = ?,
                resale_suitability = ?,
                ai_classification = ?,
                ai_notes = ?,
                ai_summary = ?,
                ai_signals = ?,
                ai_is_resellable = ?,
                ai_estimated_total_weight_grams = ?,
                ai_estimated_unit_weight_grams = ?,
                ai_recommended_resale_pack_quantity = ?,
                ai_estimated_resale_pack_weight_grams = ?,
                ai_is_resale_pack_shippable_under_100g = ?,
                ai_estimated_weight_grams = ?,
                ai_is_shippable_under_100g = ?,
                ai_provider = ?,
                ai_processed_at = datetime('now'),
                unit_price = ?,
                bulk_score = ?,
                demand_score = ?,
                trust_score = ?,
                unit_margin_score = ?,
                shipping_score = ?,
                final_score = ?
            WHERE id = ?`,
            [
                quantity,
                isBulk ? 1 : 0,
                category,
                aiConfidence,
                resaleSuitability,
                enrichedProduct.ai_classification,
                enrichedProduct.ai_notes,
                enrichedProduct.ai_summary,
                enrichedProduct.ai_signals,
                enrichedProduct.ai_is_resellable,
                enrichedProduct.ai_estimated_total_weight_grams,
                enrichedProduct.ai_estimated_unit_weight_grams,
                enrichedProduct.ai_recommended_resale_pack_quantity,
                enrichedProduct.ai_estimated_resale_pack_weight_grams,
                enrichedProduct.ai_is_resale_pack_shippable_under_100g,
                enrichedProduct.ai_estimated_weight_grams,
                enrichedProduct.ai_is_shippable_under_100g,
                enrichedProduct.ai_provider,
                unitPrice,
                scores.bulk_score,
                scores.demand_score,
                scores.trust_score,
                scores.unit_margin_score,
                scores.shipping_score,
                scores.final_score,
                productId
            ]
        );

        console.log(`[STORAGE] Enriched product ID ${productId}: score=${scores.final_score}, ai=${enrichedProduct.ai_provider}`);

        return { ...enrichedProduct, ...scores };
    }

    async enrichBatch(productIds) {
        console.log(`[STORAGE] Enriching batch of ${productIds.length} products`);

        // Reset any prior rate-limit circuit state so this run gets a fresh chance.
        await aiClassifier.initialize();
        if (typeof aiClassifier.resetCircuit === 'function') aiClassifier.resetCircuit();

        const results = [];
        for (const productId of productIds) {
            try {
                const enriched = await this.enrichProduct(productId);
                results.push(enriched);
            } catch (error) {
                console.error(`[STORAGE] Error enriching product ${productId}:`, error.message);
            }
        }

        return results;
    }

    hydrate(product) {
        if (!product) return product;
        product.images = safeParseJSON(product.images, []);
        product.ai_signals = safeParseJSON(product.ai_signals, []);
        if (product.ai_classification && typeof product.ai_classification === 'string') {
            const parsed = safeParseJSON(product.ai_classification, null);
            if (parsed) product.ai_classification_parsed = parsed;
        }
        return product;
    }

    async getTopProducts(limit = 100) {
        const priceWhere = this.buildPriceFilterWhere();
        
        // Filter by enabled categories from config
        const enabledCategories = config.categories.enabled;
        const categoryWhere = enabledCategories.length > 0 
            ? ` AND category IN (${enabledCategories.map(() => '?').join(',')})`
            : '';
        const categoryParams = enabledCategories.length > 0 ? enabledCategories : [];
        
        const products = await db.all(
            `SELECT * FROM products 
             WHERE final_score IS NOT NULL${priceWhere.sql}${categoryWhere}
             ORDER BY final_score DESC 
             LIMIT ?`,
            [...priceWhere.params, ...categoryParams, limit]
        );

        return products.map(p => this.hydrate(p));
    }

    async getProductsByCategory(category, limit = 100) {
        const priceWhere = this.buildPriceFilterWhere();
        const products = await db.all(
            `SELECT * FROM products 
             WHERE category = ? AND final_score IS NOT NULL${priceWhere.sql}
             ORDER BY final_score DESC 
             LIMIT ?`,
            [category, ...priceWhere.params, limit]
        );

        return products.map(p => this.hydrate(p));
    }

    async getRunStatistics(runId) {
        const stats = await db.get(
            `SELECT 
                COUNT(*) as total_products,
                COUNT(DISTINCT asin) as unique_asins,
                AVG(final_score) as avg_score,
                MAX(final_score) as max_score,
                COUNT(CASE WHEN is_bulk = 1 THEN 1 END) as bulk_products,
                COUNT(CASE WHEN category = 'hardware' THEN 1 END) as hardware_count,
                COUNT(CASE WHEN category = 'electronics' THEN 1 END) as electronics_count,
                COUNT(CASE WHEN category = 'tools' THEN 1 END) as tools_count
             FROM products 
             WHERE source_run_id = ?`,
            [runId]
        );

        return stats;
    }
}

module.exports = new DataStorage();
