const express = require('express');
const bodyParser = require('body-parser');
const setApiRoutes = require('./routes/api.routes');
const setPipelineRoutes = require('./routes/pipeline.routes');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

setApiRoutes(app);
setPipelineRoutes(app);

async function startServer() {
    try {
        await db.initialize();
        console.log('[SERVER] Database initialized successfully');

        app.listen(PORT, () => {
            console.log(`[SERVER] Amazon Product Discovery Engine running on http://localhost:${PORT}`);
            console.log('[SERVER] API Endpoints:');
            console.log('  - POST   /api/pipeline/scrape');
            console.log('  - POST   /api/pipeline/scrape/batch');
            console.log('  - GET    /api/pipeline/products/top');
            console.log('  - GET    /api/pipeline/export/top');
            console.log('  - GET    /api/pipeline/export/category/:category');
            console.log('  - GET    /api/pipeline/runs');
            console.log('  - GET    /api/pipeline/runs/:runId');
            console.log('  - GET    /api/scrape (legacy)');
        });
    } catch (error) {
        console.error('[SERVER] Failed to start server:', error);
        process.exit(1);
    }
}

startServer();

let isShuttingDown = false;

async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n[SERVER] Shutting down gracefully...');
    try {
        await db.close();
    } catch (error) {
        console.error('[SERVER] Error during shutdown:', error.message);
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);