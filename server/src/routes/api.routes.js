const express = require('express');
const scrapeController = require('../controllers/scrape.controller');

const router = express.Router();

function setApiRoutes(app) {
    router.get('/scrape', scrapeController.scrapeData);

    app.use('/api', router);
}

module.exports = setApiRoutes;