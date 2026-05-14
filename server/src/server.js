require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const setApiRoutes = require('./routes/api.routes');
const setPipelineRoutes = require('./routes/pipeline.routes');
const setListsRoutes = require('./routes/lists.routes');
const db = require('./database/db');
const config = require('./config/config');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

if (config.imageStorage.enabled) {
    const imageStoragePath = path.resolve(process.cwd(), config.imageStorage.storagePath);

    app.use('/files/images', express.static(imageStoragePath));

    app.get('/files/images/:filename/download', (req, res) => {
        const filename = req.params.filename;
        const filePath = path.join(imageStoragePath, filename);
        return res.download(filePath, filename);
    });
}

setApiRoutes(app);
setPipelineRoutes(app);
setListsRoutes(app);

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
            console.log('  - GET    /api/lists (product lists)');
            console.log('  - POST   /api/lists/:id/products');
            console.log('  - GET    /api/lists/:id/export');
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