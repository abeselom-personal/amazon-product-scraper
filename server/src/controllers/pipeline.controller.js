const pipeline = require('../modules/pipeline');
const excelExporter = require('../modules/excel-exporter');
const imageStorage = require('../modules/image-storage');
const dataStorage = require('../modules/data-storage');
const db = require('../database/db');
const config = require('../config/config');

class PipelineController {

    getRequestBaseUrl(req) {
        const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        const proto = forwardedProto || req.protocol || 'http';
        const host = req.get('host');
        return host ? `${proto}://${host}` : '';
    }

    async getConfig(req, res) {
        return res.json({
            categories: pipeline.listCategories(),
            filters: {
                minimumPriceGBP: config.filters.minimumPriceGBP,
                enableMinimumPrice: config.filters.enableMinimumPrice,
                maximumPriceGBP: config.filters.maximumPriceGBP,
                enableMaximumPrice: config.filters.enableMaximumPrice,
                maxShippableWeightGrams: config.filters.maxShippableWeightGrams,
            },
            ai: {
                provider: config.ai.provider,
                hasApiKey: Boolean(config.ai.google.apiKey),
                model: config.ai.google.model,
                useImage: config.ai.google.useImage,
            },
            regions: Object.keys(config.amazon.domains),
        });
    }

    async listCategories(req, res) {
        return res.json({ categories: pipeline.listCategories() });
    }

    async scrapeCategory(req, res) {
        try {
            const { category, region = 'UK', maxPages } = req.body;
            if (!category) return res.status(400).json({ error: 'category is required' });

            const result = await pipeline.executeCategoryScrape(
                category,
                region,
                maxPages ? parseInt(maxPages, 10) : null
            );

            return res.json({
                success: result.success,
                runId: result.runId,
                category: result.category,
                region: result.region,
                stats: result.stats,
                runStats: result.runStats,
                error: result.error,
            });
        } catch (error) {
            console.error('[API] Error in scrapeCategory:', error);
            return res.status(500).json({ error: 'Failed to execute category scrape', details: error.message });
        }
    }
    
    async scrapeKeyword(req, res) {
        try {
            const { keyword, region = 'UK', maxPages } = req.body;

            if (!keyword) {
                return res.status(400).json({ error: 'Keyword is required' });
            }

            const result = await pipeline.executeKeywordScrape(
                keyword, 
                region, 
                maxPages ? parseInt(maxPages, 10) : null
            );

            return res.json({
                success: result.success,
                runId: result.runId,
                keyword: result.keyword,
                region: result.region,
                stats: result.stats,
                runStats: result.runStats,
                error: result.error
            });

        } catch (error) {
            console.error('[API] Error in scrapeKeyword:', error);
            return res.status(500).json({
                error: 'Failed to execute scrape',
                details: error.message
            });
        }
    }

    async scrapeBatch(req, res) {
        try {
            const { keywords, region = 'UK', maxPages } = req.body;

            if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
                return res.status(400).json({ error: 'Keywords array is required' });
            }

            const result = await pipeline.executeBatchScrape(
                keywords, 
                region, 
                maxPages ? parseInt(maxPages, 10) : null
            );

            return res.json(result);

        } catch (error) {
            console.error('[API] Error in scrapeBatch:', error);
            return res.status(500).json({
                error: 'Failed to execute batch scrape',
                details: error.message
            });
        }
    }

    async scrapeKeywordNoAI(req, res) {
        try {
            const { keyword, region = 'UK', maxPages } = req.body;

            if (!keyword) {
                return res.status(400).json({ error: 'Keyword is required' });
            }

            const result = await pipeline.executeKeywordScrapeNoAI(
                keyword, 
                region, 
                maxPages ? parseInt(maxPages, 10) : null
            );

            return res.json({
                success: result.success,
                runId: result.runId,
                keyword: result.keyword,
                region: result.region,
                stats: result.stats,
                runStats: result.runStats,
                error: result.error
            });

        } catch (error) {
            console.error('[API] Error in scrapeKeywordNoAI:', error);
            return res.status(500).json({
                error: 'Failed to execute scrape (no AI)',
                details: error.message
            });
        }
    }

    async scrapeCategoryNoAI(req, res) {
        try {
            const { category, region = 'UK', maxPages } = req.body;
            if (!category) return res.status(400).json({ error: 'category is required' });

            const result = await pipeline.executeCategoryScrapeNoAI(
                category,
                region,
                maxPages ? parseInt(maxPages, 10) : null
            );

            return res.json({
                success: result.success,
                runId: result.runId,
                category: result.category,
                region: result.region,
                stats: result.stats,
                runStats: result.runStats,
                error: result.error,
            });
        } catch (error) {
            console.error('[API] Error in scrapeCategoryNoAI:', error);
            return res.status(500).json({ error: 'Failed to execute category scrape (no AI)', details: error.message });
        }
    }

    async scrapeBatchNoAI(req, res) {
        try {
            const { keywords, region = 'UK', maxPages } = req.body;

            if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
                return res.status(400).json({ error: 'Keywords array is required' });
            }

            const result = await pipeline.executeBatchScrapeNoAI(
                keywords, 
                region, 
                maxPages ? parseInt(maxPages, 10) : null
            );

            return res.json(result);

        } catch (error) {
            console.error('[API] Error in scrapeBatchNoAI:', error);
            return res.status(500).json({
                error: 'Failed to execute batch scrape (no AI)',
                details: error.message
            });
        }
    }

    async getTopProducts(req, res) {
        try {
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;

            const products = await pipeline.getTopRankedProducts(limit);
            const baseUrl = this.getRequestBaseUrl(req);
            const withLocalLinks = config.imageStorage.enabled
                ? await imageStorage.attachLocalImageLinksBatch(products, { baseUrl })
                : products;

            return res.json({
                products: withLocalLinks,
                count: withLocalLinks.length
            });

        } catch (error) {
            console.error('[API] Error in getTopProducts:', error);
            return res.status(500).json({
                error: 'Failed to retrieve top products',
                details: error.message
            });
        }
    }

    async getAllProducts(req, res) {
        try {
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
            const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

            const products = await dataStorage.getAllProducts(limit, offset);
            const baseUrl = this.getRequestBaseUrl(req);
            const withLocalLinks = config.imageStorage.enabled
                ? await imageStorage.attachLocalImageLinksBatch(products, { baseUrl })
                : products;

            return res.json(withLocalLinks);
        } catch (error) {
            console.error('[API] Error in getAllProducts:', error);
            return res.status(500).json({ error: 'Failed to get all products', details: error.message });
        }
    }

    async getProductsByRunId(req, res) {
        try {
            const { runId } = req.params;
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;

            const products = await dataStorage.getProductsByRunId(runId, limit);
            const baseUrl = this.getRequestBaseUrl(req);
            const withLocalLinks = config.imageStorage.enabled
                ? await imageStorage.attachLocalImageLinksBatch(products, { baseUrl })
                : products;

            return res.json(withLocalLinks);
        } catch (error) {
            console.error('[API] Error in getProductsByRunId:', error);
            return res.status(500).json({ error: 'Failed to get products by run ID', details: error.message });
        }
    }

    async exportByRunId(req, res) {
        try {
            const { runId } = req.params;
            const baseUrl = this.getRequestBaseUrl(req);

            const products = await dataStorage.getProductsByRunId(runId, 1000);

            if (!products || products.length === 0) {
                return res.status(404).json({ error: 'No products found for this run' });
            }

            const result = await excelExporter.exportProducts(products, { baseUrl, filenamePrefix: `run_${runId}` });

            return res.download(result.filepath, result.filename);

        } catch (error) {
            console.error('[API] Error in exportByRunId:', error);
            return res.status(500).json({ error: 'Failed to export run products', details: error.message });
        }
    }

    async getRunHistory(req, res) {
        try {
            const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;

            const runs = await pipeline.getRunHistory(limit);

            return res.json({
                runs,
                count: runs.length
            });

        } catch (error) {
            console.error('[API] Error in getRunHistory:', error);
            return res.status(500).json({
                error: 'Failed to retrieve run history',
                details: error.message
            });
        }
    }

    async getRunStats(req, res) {
        try {
            const { runId } = req.params;

            const run = await db.get('SELECT * FROM scraping_runs WHERE id = ?', [runId]);

            if (!run) {
                return res.status(404).json({ error: 'Run not found' });
            }

            const whereParts = ['source_run_id = ?', 'final_score IS NOT NULL'];
            const params = [runId];
            if (config.filters.enableMinimumPrice) {
                whereParts.push('price >= ?');
                params.push(config.filters.minimumPriceGBP);
            }
            if (config.filters.enableMaximumPrice) {
                whereParts.push('price <= ?');
                params.push(config.filters.maximumPriceGBP);
            }
            params.push(10);

            const products = await db.all(
                `SELECT * FROM products 
                 WHERE ${whereParts.join(' AND ')}
                 ORDER BY final_score DESC 
                 LIMIT 10`,
                params
            );

            return res.json({
                run,
                topProducts: products
            });

        } catch (error) {
            console.error('[API] Error in getRunStats:', error);
            return res.status(500).json({
                error: 'Failed to retrieve run statistics',
                details: error.message
            });
        }
    }
}

module.exports = new PipelineController();
