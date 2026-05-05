# Quick Start Guide

## Installation (5 minutes)

```bash
# 1. Navigate to server directory
cd server

# 2. Install dependencies
npm install

# 3. Initialize database
npm run init-db
```

## First Scrape (2 minutes)

```bash
# Scrape Amazon UK for "bulk screws" (3 pages)
npm run cli scrape "bulk screws" UK 3
```

Expected output:
```
=== Starting Scrape ===
Keyword: bulk screws
Region: UK
Max Pages: 3

[PIPELINE] Starting scrape...
[SCRAPER] Found 48 products
[PIPELINE] Saved 45 new, 0 updated, 3 duplicates
[PIPELINE] Enrichment complete

=== Scrape Complete ===
Run ID: abc123...
Products Scraped: 48
New Products: 45
Average Score: 0.542
```

## View Results (30 seconds)

```bash
# Show top 10 ranked products
npm run cli top 10
```

## Export to Excel (30 seconds)

```bash
# Export top 50 products
npm run cli export 50

# File saved to: ./exports/amazon_products_YYYY-MM-DD.xlsx
```

## Run API Server (Optional)

```bash
# Start REST API
npm start

# Server runs on http://localhost:3000
```

Test with curl:
```bash
curl -X POST http://localhost:3000/api/pipeline/scrape \
  -H "Content-Type: application/json" \
  -d '{"keyword":"bulk hardware","region":"UK","maxPages":2}'
```

## Common Commands

```bash
# Scrape multiple pages
npm run cli scrape "office supplies bulk" UK 5

# View top 20 products
npm run cli top 20

# Export top 100 products
npm run cli export 100

# Get help
npm run cli help
```

## Next Steps

1. Read `PRODUCTION_README.md` for full documentation
2. Configure `.env` for custom settings
3. Explore API endpoints at http://localhost:3000
4. Set up batch scraping for multiple keywords

## Troubleshooting

**Chromium not found?**
```bash
sudo apt-get install chromium-browser
```

**Database errors?**
```bash
rm -f data/products.db
npm run init-db
```

**Need help?**
```bash
npm run cli help
```
