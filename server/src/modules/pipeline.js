const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const enhancedScraper = require('./enhanced-scraper');
const dataStorage = require('./data-storage');
const aiClassifier = require('./ai-classifier');
const config = require('../config/config');

class Pipeline {
    
    async createRun({ keyword, region, category = null, runType = 'keyword' }) {
        const runId = uuidv4();
        await db.run(
            `INSERT INTO scraping_runs (id, keyword, region, category, run_type, started_at, status)
             VALUES (?, ?, ?, ?, ?, datetime('now'), 'running')`,
            [runId, keyword, region, category, runType]
        );
        console.log(`[PIPELINE] Created ${runType} run ${runId} (${category ? 'cat=' + category + ', ' : ''}keyword="${keyword}")`);
        return runId;
    }

    async updateRunStatus(runId, status, stats = {}) {
        await db.run(
            `UPDATE scraping_runs SET
                status = ?,
                completed_at = datetime('now'),
                products_scraped = ?,
                products_new = ?,
                products_updated = ?,
                products_deduplicated = ?,
                products_filtered = ?,
                error_message = ?
             WHERE id = ?`,
            [
                status,
                stats.scraped || 0,
                stats.new || 0,
                stats.updated || 0,
                stats.deduplicated || 0,
                stats.filtered || 0,
                stats.error || null,
                runId
            ]
        );
    }

    async processProducts(products, runId, stats) {
        const productIds = [];
        for (const product of products) {
            const saveResult = await dataStorage.saveProduct(product, runId);
            if (saveResult.action === 'inserted') {
                stats.new++;
                productIds.push(saveResult.productId);
            } else if (saveResult.action === 'updated') {
                stats.updated++;
                productIds.push(saveResult.productId);
            } else if (saveResult.action === 'skipped_duplicate_in_run') {
                stats.deduplicated++;
            } else if (saveResult.action === 'skipped_price_filter' || saveResult.action === 'skipped_below_min_price') {
                stats.filtered++;
            } else if (saveResult.action === 'skipped_invalid_url') {
                stats.filtered++;
            }
        }
        return productIds;
    }

    async executeKeywordScrape(keyword, region = 'UK', maxPages = null) {
        const runId = await this.createRun({ keyword, region, runType: 'keyword' });

        const stats = { scraped: 0, new: 0, updated: 0, deduplicated: 0, filtered: 0, error: null };

        try {
            console.log(`[PIPELINE] Starting keyword scrape for "${keyword}" in ${region}`);
            const scrapeResult = await enhancedScraper.scrapeKeyword(keyword, region, maxPages);
            stats.scraped = scrapeResult.products.length;

            console.log(`[PIPELINE] Scraped ${stats.scraped} products. Min-price filter: £${config.filters.minimumPriceGBP} (enabled=${config.filters.enableMinimumPrice})`);

            const productIds = await this.processProducts(scrapeResult.products, runId, stats);

            console.log(`[PIPELINE] Saved ${stats.new} new, ${stats.updated} updated, ${stats.deduplicated} dedup'd, ${stats.filtered} below-price`);

            // Mark run as completed before AI enrichment (scraping succeeded)
            await this.updateRunStatus(runId, 'completed', stats);
            const runStats = await dataStorage.getRunStatistics(runId);

            // AI enrichment is best-effort - failures shouldn't affect run status
            try {
                await aiClassifier.initialize();
                console.log(`[PIPELINE] Enriching products with AI...`);
                await dataStorage.enrichBatch(productIds);
            } catch (aiError) {
                console.error(`[PIPELINE] AI enrichment failed (non-critical):`, aiError.message);
                stats.error = `Scraping succeeded but AI enrichment failed: ${aiError.message}`;
                // Update run with error message but keep status as completed
                await this.updateRunStatus(runId, 'completed', stats);
            }

            return { runId, keyword, region, stats, runStats, success: true };
        } catch (error) {
            console.error(`[PIPELINE] Error in run ${runId}:`, error);
            stats.error = error.message;
            await this.updateRunStatus(runId, 'failed', stats);
            return { runId, keyword, region, stats, error: error.message, success: false };
        }
    }

    async executeCategoryScrape(categoryName, region = 'UK', maxPages = null) {
        if (!config.categories.sources[categoryName]) {
            throw new Error(`Unknown category "${categoryName}". Available: ${Object.keys(config.categories.sources).join(', ')}`);
        }
        const runId = await this.createRun({
            keyword: `[category:${categoryName}]`,
            region,
            category: categoryName,
            runType: 'category',
        });
        const stats = { scraped: 0, new: 0, updated: 0, deduplicated: 0, filtered: 0, error: null };

        try {
            console.log(`[PIPELINE] Starting CATEGORY scrape: ${categoryName} (${region})`);
            const scrapeResult = await enhancedScraper.scrapeCategory(categoryName, region, maxPages);
            stats.scraped = scrapeResult.products.length;

            console.log(`[PIPELINE] Scraped ${stats.scraped} products. Price filter: min=${config.filters.enableMinimumPrice ? '£' + config.filters.minimumPriceGBP : 'off'}, max=${config.filters.enableMaximumPrice ? '£' + config.filters.maximumPriceGBP : 'off'}`);

            const productIds = await this.processProducts(scrapeResult.products, runId, stats);

            console.log(`[PIPELINE] Saved ${stats.new} new, ${stats.updated} updated, ${stats.deduplicated} dup'd, ${stats.filtered} below-price`);

            // Mark run as completed before AI enrichment (scraping succeeded)
            await this.updateRunStatus(runId, 'completed', stats);
            const runStats = await dataStorage.getRunStatistics(runId);

            // AI enrichment is best-effort - failures shouldn't affect run status
            try {
                await aiClassifier.initialize();
                console.log(`[PIPELINE] Enriching ${productIds.length} products with AI...`);
                await dataStorage.enrichBatch(productIds);
            } catch (aiError) {
                console.error(`[PIPELINE] AI enrichment failed (non-critical):`, aiError.message);
                stats.error = `Scraping succeeded but AI enrichment failed: ${aiError.message}`;
                // Update run with error message but keep status as completed
                await this.updateRunStatus(runId, 'completed', stats);
            }

            return { runId, category: categoryName, region, stats, runStats, success: true };
        } catch (error) {
            console.error(`[PIPELINE] Error in run ${runId}:`, error);
            stats.error = error.message;
            await this.updateRunStatus(runId, 'failed', stats);
            return { runId, category: categoryName, region, stats, error: error.message, success: false };
        }
    }

    listCategories() {
        return config.categories.enabled.map((name) => ({
            name,
            ...(config.categories.sources[name] || {}),
        }));
    }

    async executeBatchScrape(keywords, region = 'UK', maxPages = null) {
        console.log(`[PIPELINE] Starting batch scrape for ${keywords.length} keywords`);
        
        const results = [];

        for (const keyword of keywords) {
            console.log(`\n[PIPELINE] ========== Processing keyword: "${keyword}" ==========`);
            
            const result = await this.executeKeywordScrape(keyword, region, maxPages);
            results.push(result);

            if (!result.success) {
                console.error(`[PIPELINE] Failed to process keyword: "${keyword}"`);
            }
        }

        const summary = {
            totalKeywords: keywords.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            totalProductsScraped: results.reduce((sum, r) => sum + (r.stats?.scraped || 0), 0),
            totalProductsNew: results.reduce((sum, r) => sum + (r.stats?.new || 0), 0),
            totalProductsUpdated: results.reduce((sum, r) => sum + (r.stats?.updated || 0), 0),
            results
        };

        console.log(`\n[PIPELINE] ========== Batch Complete ==========`);
        console.log(`[PIPELINE] Processed ${summary.totalKeywords} keywords`);
        console.log(`[PIPELINE] Success: ${summary.successful}, Failed: ${summary.failed}`);
        console.log(`[PIPELINE] Total products: ${summary.totalProductsScraped}`);
        console.log(`[PIPELINE] New: ${summary.totalProductsNew}, Updated: ${summary.totalProductsUpdated}`);

        return summary;
    }

    async getTopRankedProducts(limit = 100) {
        return await dataStorage.getTopProducts(limit);
    }

    async getRunHistory(limit = 10) {
        const runs = await db.all(
            `SELECT * FROM scraping_runs 
             ORDER BY started_at DESC 
             LIMIT ?`,
            [limit]
        );

        return runs;
    }
}

module.exports = new Pipeline();
