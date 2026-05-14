const express = require('express');
const pipelineController = require('../controllers/pipeline.controller');

const router = express.Router();

function setPipelineRoutes(app) {
    router.get('/config', pipelineController.getConfig.bind(pipelineController));
    router.get('/categories', pipelineController.listCategories.bind(pipelineController));

    router.post('/scrape', pipelineController.scrapeKeyword.bind(pipelineController));
    router.post('/scrape/batch', pipelineController.scrapeBatch.bind(pipelineController));
    router.post('/scrape/category', pipelineController.scrapeCategory.bind(pipelineController));

    // Non-AI endpoints for faster large-scale scraping
    router.post('/scrape/no-ai', pipelineController.scrapeKeywordNoAI.bind(pipelineController));
    router.post('/scrape/batch/no-ai', pipelineController.scrapeBatchNoAI.bind(pipelineController));
    router.post('/scrape/category/no-ai', pipelineController.scrapeCategoryNoAI.bind(pipelineController));

    router.get('/products/top', pipelineController.getTopProducts.bind(pipelineController));
    router.get('/products/all', pipelineController.getAllProducts.bind(pipelineController));
    router.get('/products/run/:runId', pipelineController.getProductsByRunId.bind(pipelineController));

    router.get('/export/top', pipelineController.exportTopProducts.bind(pipelineController));
    router.get('/export/category/:category', pipelineController.exportByCategory.bind(pipelineController));

    router.get('/runs', pipelineController.getRunHistory.bind(pipelineController));
    router.get('/runs/:runId', pipelineController.getRunStats.bind(pipelineController));

    app.use('/api/pipeline', router);
}

module.exports = setPipelineRoutes;
