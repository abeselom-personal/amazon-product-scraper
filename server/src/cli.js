#!/usr/bin/env node

require('dotenv').config();
const db = require('./database/db');
const pipeline = require('./modules/pipeline');
const excelExporter = require('./modules/excel-exporter');
const aiClassifier = require('./modules/ai-classifier');

const COMMANDS = {
    scrape: 'Scrape Amazon for keywords and store results',
    export: 'Export top ranked products to Excel',
    stats: 'Show statistics for a scraping run',
    top: 'Display top ranked products',
    help: 'Show this help message'
};

async function showHelp() {
    console.log('\n=== Amazon Product Discovery Engine CLI ===\n');
    console.log('Usage: npm run cli <command> [options]\n');
    console.log('Commands:');
    Object.entries(COMMANDS).forEach(([cmd, desc]) => {
        console.log(`  ${cmd.padEnd(12)} ${desc}`);
    });
    console.log('\nExamples:');
    console.log('  npm run cli scrape "screws bulk" UK 3');
    console.log('  npm run cli export 100');
    console.log('  npm run cli top 20');
    console.log('  npm run cli stats <run-id>');
    console.log('');
}

async function scrapeCommand(args) {
    const keyword = args[0];
    const region = args[1] || 'UK';
    const maxPages = args[2] ? parseInt(args[2], 10) : null;

    if (!keyword) {
        console.error('Error: Keyword is required');
        console.log('Usage: npm run cli scrape "<keyword>" [region] [maxPages]');
        process.exit(1);
    }

    console.log(`\n=== Starting Scrape ===`);
    console.log(`Keyword: ${keyword}`);
    console.log(`Region: ${region}`);
    console.log(`Max Pages: ${maxPages || 'unlimited'}\n`);

    await db.initialize();
    await aiClassifier.initialize();

    const result = await pipeline.executeKeywordScrape(keyword, region, maxPages);

    console.log('\n=== Scrape Complete ===');
    console.log(`Run ID: ${result.runId}`);
    console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Products Scraped: ${result.stats.scraped}`);
    console.log(`New Products: ${result.stats.new}`);
    console.log(`Updated Products: ${result.stats.updated}`);
    console.log(`Duplicates Skipped: ${result.stats.deduplicated}`);
    
    if (result.runStats) {
        console.log(`\nRun Statistics:`);
        console.log(`  Total Products: ${result.runStats.total_products}`);
        console.log(`  Unique ASINs: ${result.runStats.unique_asins}`);
        console.log(`  Average Score: ${result.runStats.avg_score?.toFixed(3) || 'N/A'}`);
        console.log(`  Max Score: ${result.runStats.max_score?.toFixed(3) || 'N/A'}`);
        console.log(`  Bulk Products: ${result.runStats.bulk_products}`);
        console.log(`  Hardware: ${result.runStats.hardware_count}`);
        console.log(`  Electronics: ${result.runStats.electronics_count}`);
        console.log(`  Tools: ${result.runStats.tools_count}`);
    }

    if (result.error) {
        console.error(`\nError: ${result.error}`);
    }

    await aiClassifier.shutdown();
    await db.close();
}

async function exportCommand(args) {
    const limit = args[0] ? parseInt(args[0], 10) : 100;

    console.log(`\n=== Exporting Top ${limit} Products ===\n`);

    await db.initialize();

    const exportResult = await excelExporter.exportTopProducts(limit);

    console.log('\n=== Export Complete ===');
    console.log(`File: ${exportResult.filepath}`);
    console.log(`Products Exported: ${exportResult.productCount}`);

    await db.close();
}

async function topCommand(args) {
    const limit = args[0] ? parseInt(args[0], 10) : 20;

    console.log(`\n=== Top ${limit} Ranked Products ===\n`);

    await db.initialize();

    const products = await pipeline.getTopRankedProducts(limit);

    if (products.length === 0) {
        console.log('No products found. Run a scrape first.');
    } else {
        products.forEach((product, index) => {
            console.log(`${(index + 1).toString().padStart(3)}. [${product.final_score.toFixed(3)}] ${product.title?.substring(0, 80)}`);
            console.log(`     Price: £${product.price} | Qty: ${product.quantity_estimate} | Unit: £${product.unit_price?.toFixed(2)}`);
            console.log(`     Category: ${product.category} | Bulk: ${product.is_bulk ? 'Yes' : 'No'} | Rating: ${product.rating || 'N/A'} (${product.review_count} reviews)`);
            console.log(`     Scores - Bulk: ${product.bulk_score} | Demand: ${product.demand_score} | Trust: ${product.trust_score} | Margin: ${product.unit_margin_score}`);
            console.log('');
        });
    }

    await db.close();
}

async function statsCommand(args) {
    const runId = args[0];

    if (!runId) {
        console.error('Error: Run ID is required');
        console.log('Usage: npm run cli stats <run-id>');
        process.exit(1);
    }

    await db.initialize();

    const run = await db.get('SELECT * FROM scraping_runs WHERE id = ?', [runId]);

    if (!run) {
        console.error(`Run not found: ${runId}`);
        await db.close();
        process.exit(1);
    }

    console.log(`\n=== Run Statistics ===`);
    console.log(`Run ID: ${run.id}`);
    console.log(`Keyword: ${run.keyword}`);
    console.log(`Region: ${run.region}`);
    console.log(`Status: ${run.status}`);
    console.log(`Started: ${run.started_at}`);
    console.log(`Completed: ${run.completed_at || 'N/A'}`);
    console.log(`Products Scraped: ${run.products_scraped}`);
    console.log(`New: ${run.products_new}`);
    console.log(`Updated: ${run.products_updated}`);
    console.log(`Deduplicated: ${run.products_deduplicated}`);

    if (run.error_message) {
        console.log(`Error: ${run.error_message}`);
    }

    await db.close();
}

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const commandArgs = args.slice(1);

    if (!command || command === 'help') {
        await showHelp();
        process.exit(0);
    }

    try {
        switch (command) {
            case 'scrape':
                await scrapeCommand(commandArgs);
                break;
            case 'export':
                await exportCommand(commandArgs);
                break;
            case 'top':
                await topCommand(commandArgs);
                break;
            case 'stats':
                await statsCommand(commandArgs);
                break;
            default:
                console.error(`Unknown command: ${command}`);
                await showHelp();
                process.exit(1);
        }
    } catch (error) {
        console.error('\n=== ERROR ===');
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
