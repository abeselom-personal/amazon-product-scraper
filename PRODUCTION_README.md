# Amazon Product Discovery & Ranking Engine

A production-ready system for scraping Amazon UK, detecting bulk products, preventing duplicates, and ranking products by resale potential using local AI classification.

## 🎯 Features

### Core Capabilities
- **Intelligent Scraping**: Multi-page Amazon UK scraping with retry logic, rate limiting, and user-agent rotation
- **Robust Deduplication**: Prevents duplicate products using ASIN, URL, and title+price matching
- **AI Classification**: Local Qwen 2.5 model for product categorization and bulk detection
- **Advanced Scoring**: Multi-factor ranking system based on bulk potential, demand, trust, and unit margins
- **Data Persistence**: SQLite database with idempotent writes and comprehensive indexing
- **Excel Export**: Formatted exports of top-ranked products with color-coded scores

### Technical Highlights
- Modular, production-grade architecture
- Configurable via environment variables
- CLI and REST API interfaces
- Batch processing support
- Session tracking and run history
- Zero external API dependencies (local AI only)

## 📋 Requirements

- **Node.js**: 14.0.0 or higher
- **Chromium**: For Puppeteer headless browsing
- **Storage**: ~100MB for database and exports
- **Memory**: 2GB+ recommended for AI model

## 🚀 Installation

### 1. Install Dependencies

```bash
cd server
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your preferred settings
```

### 3. Initialize Database

```bash
npm run init-db
```

### 4. Verify Installation

```bash
npm run cli help
```

## 📖 Usage

### CLI Interface (Recommended)

#### Scrape Products

```bash
# Basic scrape
npm run cli scrape "bulk screws" UK 3

# Arguments: <keyword> [region] [maxPages]
npm run cli scrape "office supplies bulk" UK 5
```

#### View Top Products

```bash
# Show top 20 products
npm run cli top 20

# Show top 50 products
npm run cli top 50
```

#### Export to Excel

```bash
# Export top 100 products
npm run cli export 100

# Export top 50 products
npm run cli export 50
```

#### View Run Statistics

```bash
npm run cli stats <run-id>
```

### REST API Interface

#### Start Server

```bash
npm start
# Server runs on http://localhost:3000
```

#### API Endpoints

**Scrape Single Keyword**
```bash
POST /api/pipeline/scrape
Content-Type: application/json

{
  "keyword": "bulk screws",
  "region": "UK",
  "maxPages": 3
}
```

**Scrape Multiple Keywords**
```bash
POST /api/pipeline/scrape/batch
Content-Type: application/json

{
  "keywords": ["bulk screws", "office supplies", "hardware kits"],
  "region": "UK",
  "maxPages": 2
}
```

**Get Top Products**
```bash
GET /api/pipeline/products/top?limit=100
```

**Export Top Products**
```bash
GET /api/pipeline/export/top?limit=100
```

**Export by Category**
```bash
GET /api/pipeline/export/category/hardware?limit=50
```

**Get Run History**
```bash
GET /api/pipeline/runs?limit=10
```

**Get Run Details**
```bash
GET /api/pipeline/runs/:runId
```

## 🏗️ Architecture

### Module Structure

```
server/src/
├── config/
│   └── config.js              # Centralized configuration
├── database/
│   ├── db.js                  # SQLite database wrapper
│   └── schema.sql             # Database schema
├── modules/
│   ├── deduplication.js       # Deduplication engine
│   ├── quantity-extractor.js  # Bulk detection with regex
│   ├── ai-classifier.js       # Qwen 2.5 AI integration
│   ├── scoring-engine.js      # Multi-factor scoring
│   ├── enhanced-scraper.js    # Robust scraper with retries
│   ├── data-storage.js        # Idempotent storage layer
│   ├── pipeline.js            # Orchestration engine
│   └── excel-exporter.js      # Excel export functionality
├── controllers/
│   ├── scrape.controller.js   # Legacy scraper (preserved)
│   └── pipeline.controller.js # New pipeline API
├── routes/
│   ├── api.routes.js          # Legacy routes
│   └── pipeline.routes.js     # Pipeline routes
├── scripts/
│   └── init-database.js       # Database initialization
├── cli.js                     # CLI interface
└── server.js                  # Express server
```

### Data Flow

```
1. Scrape Amazon UK → Extract products
2. Normalize data → Extract ASIN, clean titles
3. Deduplicate → Check ASIN, URL, title+price
4. Extract quantity → Regex patterns + AI verification
5. AI Classification → Category, bulk status, resale potential
6. Score products → Bulk + Demand + Trust + Margin
7. Store in DB → Idempotent writes
8. Rank & Export → Top N by final score
```

## 🎯 Scoring System

### Final Score Formula

```
Final Score = (Bulk Score × 0.30) + 
              (Demand Score × 0.25) + 
              (Trust Score × 0.20) + 
              (Unit Margin Score × 0.25)
```

### Component Scores

**Bulk Score** (30% weight)
- Based on quantity detected
- High: 100+ units = 1.0
- Medium: 20-99 units = 0.7
- Low: 5-19 units = 0.4

**Demand Score** (25% weight)
- Log-scaled review count (60%)
- Rating normalized (40%)

**Trust Score** (20% weight)
- Rating ≥ 4.3 = +0.4
- Reviews ≥ 100 = +0.4
- Prime eligible = +0.2

**Unit Margin Score** (25% weight)
- Estimated resale margin by category
- Hardware: 2x-5x multiplier
- Electronics: 1.5x-3x multiplier
- Tools: 2x-4x multiplier

## 🔧 Configuration

### Environment Variables

All settings in `.env` file:

```bash
# Database
DB_PATH=./data/products.db
DEDUP_TTL_DAYS=7

# Scraper
MAX_RETRIES=3
RATE_LIMIT_MS=1000

# AI Model
AI_MODEL_PATH=./models/qwen2.5-small
AI_BATCH_SIZE=10
AI_CONFIDENCE_THRESHOLD=0.7

# Scoring Weights
WEIGHT_BULK=0.30
WEIGHT_DEMAND=0.25
WEIGHT_TRUST=0.20
WEIGHT_UNIT_MARGIN=0.25

# Export
EXPORT_TOP_N=100
EXPORT_PATH=./exports
```

## 🗄️ Database Schema

### Tables

**products** - Main product storage
- Deduplication fields: `asin`, `normalized_url`, `normalized_title`
- Enrichment fields: `quantity_estimate`, `is_bulk`, `category`, `ai_confidence_score`
- Scoring fields: `bulk_score`, `demand_score`, `trust_score`, `unit_margin_score`, `final_score`
- Tracking fields: `created_at`, `last_seen_at`, `source_run_id`

**scraping_runs** - Run tracking
- Metadata: `keyword`, `region`, `status`
- Statistics: `products_scraped`, `products_new`, `products_updated`, `products_deduplicated`

**deduplication_log** - Audit trail
- Tracks all duplicate detections with match type and confidence

**ai_processing_queue** - AI batch processing
- Manages products pending AI classification

## 🤖 AI Integration

### Qwen 2.5 Local Model

The system uses a local AI model for:
- Product categorization (electronics, hardware, tools, office supplies, misc)
- Bulk detection verification
- Quantity extraction from complex titles
- Resale suitability estimation

**Note**: Current implementation includes a mock AI classifier for development. To integrate the actual Qwen 2.5 model:

1. Download Qwen 2.5 small model
2. Update `AI_MODEL_PATH` in `.env`
3. Implement model loading in `ai-classifier.js` using llama.cpp or transformers
4. Replace `generateMockResponse()` with actual model inference

## 📊 Excel Export Format

Exported files include:
- Rank, Title, ASIN, Price, Quantity, Unit Price
- Category, Bulk Status, Rating, Reviews, Prime
- All score components (Bulk, Demand, Trust, Margin, Final)
- Resale suitability, AI confidence
- Product URL

Color coding:
- Green: Final score ≥ 0.7 (High potential)
- Yellow: Final score ≥ 0.5 (Medium potential)
- White: Final score < 0.5 (Low potential)

## 🔍 Deduplication Logic

### Three-Tier Matching

1. **ASIN Match** (100% confidence)
   - Exact ASIN match = duplicate

2. **URL Match** (95% confidence)
   - Normalized URL match = duplicate

3. **Title + Price Match** (80-95% confidence)
   - Jaccard similarity > 0.8 on normalized titles
   - Price within 5% tolerance
   - Only checks products within TTL window (default: 7 days)

### Same-Run Protection

Products are never duplicated within the same scraping run, even if pagination returns the same product multiple times.

## 🚦 Performance Optimization

- **Rate Limiting**: Configurable delay between requests
- **Retry Logic**: Exponential backoff on failures
- **User-Agent Rotation**: 5 different user agents
- **Resource Blocking**: Images, CSS, fonts blocked in Puppeteer
- **Batch AI Processing**: Configurable batch size for AI inference
- **Database Indexing**: Optimized indexes on all lookup fields

## 📝 Example Workflow

```bash
# 1. Initialize system
npm run init-db

# 2. Scrape products
npm run cli scrape "bulk hardware" UK 5

# 3. View top results
npm run cli top 20

# 4. Export to Excel
npm run cli export 100

# 5. Check exports folder
ls -lh exports/
```

## 🐛 Troubleshooting

### Chromium Not Found
```bash
# Install Chromium
sudo apt-get install chromium-browser  # Ubuntu/Debian
brew install chromium                   # macOS
```

### Database Locked
```bash
# Close all connections and reinitialize
rm -f data/products.db
npm run init-db
```

### AI Model Errors
- Verify `AI_MODEL_PATH` points to valid model
- Check model format compatibility
- Ensure sufficient memory (2GB+)

## 📈 Production Deployment

### Recommended Setup

1. **Environment**: Linux server with 4GB+ RAM
2. **Process Manager**: PM2 for auto-restart
3. **Monitoring**: Log aggregation and alerting
4. **Backup**: Regular SQLite database backups
5. **Scaling**: Run multiple instances with separate databases

### PM2 Example

```bash
npm install -g pm2
pm2 start src/server.js --name amazon-scraper
pm2 save
pm2 startup
```

## 📄 License

MIT License - See LICENSE file

## 🤝 Support

For issues or questions:
1. Check troubleshooting section
2. Review configuration settings
3. Examine log output for errors
4. Verify all dependencies installed

---

**Built with production-grade practices**: Modular architecture, comprehensive error handling, idempotent operations, and deterministic pipelines.
