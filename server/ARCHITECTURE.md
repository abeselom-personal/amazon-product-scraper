# System Architecture

## Overview

The Amazon Product Discovery Engine is built with a modular, production-grade architecture designed for reliability, maintainability, and scalability.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Interfaces                          │
├──────────────────┬──────────────────┬──────────────────────────┤
│   CLI Interface  │   REST API       │   Legacy Web UI          │
│   (cli.js)       │   (Express)      │   (client/)              │
└────────┬─────────┴────────┬─────────┴──────────────────────────┘
         │                  │
         └──────────┬───────┘
                    │
         ┌──────────▼──────────┐
         │  Pipeline Controller │
         │  (Orchestration)     │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────────────────────────────────┐
         │              Pipeline Engine                     │
         │  - Run Management                                │
         │  - Batch Processing                              │
         │  - Error Handling                                │
         └──┬────────┬────────┬────────┬────────┬──────────┘
            │        │        │        │        │
    ┌───────▼──┐ ┌──▼────┐ ┌─▼─────┐ ┌▼──────┐ ┌▼────────┐
    │ Enhanced │ │ Dedup │ │ Qty   │ │ AI    │ │ Scoring │
    │ Scraper  │ │ Engine│ │ Extr. │ │ Class.│ │ Engine  │
    └───────┬──┘ └──┬────┘ └─┬─────┘ └┬──────┘ └┬────────┘
            │       │        │        │        │
            └───────┴────────┴────────┴────────┘
                           │
                    ┌──────▼──────┐
                    │ Data Storage │
                    │   (SQLite)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Database   │
                    │  - Products │
                    │  - Runs     │
                    │  - Dedup Log│
                    └─────────────┘
```

## Core Modules

### 1. Enhanced Scraper (`enhanced-scraper.js`)

**Responsibilities**:
- Amazon UK page scraping with Puppeteer
- Retry logic with exponential backoff
- Rate limiting and user-agent rotation
- HTML parsing with Cheerio
- Pagination handling

**Key Features**:
- Resource blocking (images, CSS) for performance
- Multiple fallback selectors for price extraction
- ASIN extraction from URLs
- Review count and rating parsing
- Prime eligibility detection

**Error Handling**:
- Automatic retries (configurable, default 3)
- Exponential backoff delays
- Graceful degradation on selector failures

---

### 2. Deduplication Engine (`deduplication.js`)

**Responsibilities**:
- Multi-tier duplicate detection
- Title and URL normalization
- Similarity calculations
- Deduplication logging

**Matching Strategies**:

1. **ASIN Match** (100% confidence)
   - Exact ASIN comparison
   - Highest priority

2. **URL Match** (95% confidence)
   - Normalized URL comparison
   - Extracts ASIN from URL patterns

3. **Title + Price Match** (80-95% confidence)
   - Jaccard similarity on normalized titles
   - Price tolerance check (5%)
   - Time window filtering (TTL)

**Normalization**:
- Title: Lowercase, remove special chars, collapse whitespace
- URL: Extract ASIN or normalize pathname
- Price: Percentage-based tolerance

---

### 3. Quantity Extractor (`quantity-extractor.js`)

**Responsibilities**:
- Regex-based quantity detection
- Bulk keyword identification
- Confidence scoring

**Patterns Detected**:
- "Pack of X", "X pack", "X pcs", "X pieces"
- "Set of X", "X units", "X count"
- "X x Y" (multiplication)
- Bulk keywords: "bulk", "wholesale", "multipack", etc.

**Output**:
- Quantity estimate
- Bulk status (boolean)
- Confidence score (0-1)
- AI verification flag

---

### 4. AI Classifier (`ai-classifier.js`)

**Responsibilities**:
- Product categorization
- Bulk verification
- Resale suitability estimation
- Confidence scoring

**Categories**:
- electronics
- hardware
- office_supplies
- tools
- misc

**Integration Points**:
- Qwen 2.5 local model (configurable)
- Batch processing support
- Fallback classification on errors

**Current Implementation**:
- Mock classifier for development
- Structured JSON prompt/response
- Validation and sanitization

---

### 5. Scoring Engine (`scoring-engine.js`)

**Responsibilities**:
- Multi-factor score calculation
- Component score computation
- Product ranking

**Scoring Formula**:
```
Final Score = (Bulk × 0.30) + (Demand × 0.25) + (Trust × 0.20) + (Margin × 0.25)
```

**Component Calculations**:

**Bulk Score**:
- Quantity-based thresholds
- Bulk keyword bonus

**Demand Score**:
- Log-scaled review count (60%)
- Normalized rating (40%)

**Trust Score**:
- Rating threshold (≥4.3)
- Review count threshold (≥100)
- Prime eligibility

**Unit Margin Score**:
- Category-based multipliers
- Total margin estimation
- Margin ratio bonus

---

### 6. Data Storage (`data-storage.js`)

**Responsibilities**:
- Idempotent product saves
- Duplicate handling
- Product enrichment
- Statistics aggregation

**Operations**:

**Save Product**:
1. Check duplicate in current run
2. Find duplicates across all runs
3. Insert new or update existing
4. Return action type

**Enrich Product**:
1. Extract quantity (regex)
2. Classify with AI (if needed)
3. Calculate scores
4. Update database

**Batch Processing**:
- Sequential enrichment
- Error isolation
- Progress logging

---

### 7. Pipeline Orchestrator (`pipeline.js`)

**Responsibilities**:
- End-to-end workflow execution
- Run tracking
- Batch processing
- Statistics collection

**Workflow Steps**:
1. Create run record
2. Scrape products
3. Save with deduplication
4. Initialize AI classifier
5. Enrich products
6. Update run status
7. Return statistics

**Run Management**:
- UUID-based run IDs
- Status tracking (running, completed, failed)
- Detailed statistics
- Error logging

---

### 8. Excel Exporter (`excel-exporter.js`)

**Responsibilities**:
- Excel file generation
- Data formatting
- Color coding
- Auto-filtering

**Export Features**:
- Comprehensive column set
- Color-coded scores
- Auto-filter headers
- Timestamp-based filenames

---

## Data Flow

### Scraping Pipeline

```
1. User Request (CLI/API)
   ↓
2. Pipeline.executeKeywordScrape()
   ↓
3. EnhancedScraper.scrapeKeyword()
   ├─ Puppeteer launch
   ├─ Page navigation
   ├─ HTML extraction
   └─ Product parsing
   ↓
4. DataStorage.saveProduct() [for each product]
   ├─ Deduplication.checkDuplicateInCurrentRun()
   ├─ Deduplication.findDuplicates()
   └─ Insert or Update
   ↓
5. AIClassifier.initialize()
   ↓
6. DataStorage.enrichBatch()
   ├─ QuantityExtractor.estimateBulkStatus()
   ├─ AIClassifier.classifyProduct() [if needed]
   └─ ScoringEngine.calculateFinalScore()
   ↓
7. Update run status
   ↓
8. Return results
```

### Deduplication Flow

```
New Product
   ↓
Check ASIN
   ├─ Match? → Update existing
   └─ No match
       ↓
   Check URL
       ├─ Match? → Update existing
       └─ No match
           ↓
       Check Title + Price
           ├─ Match? → Update existing
           └─ No match → Insert new
```

### Scoring Flow

```
Product Data
   ↓
Calculate Bulk Score
   ├─ Quantity thresholds
   └─ Bulk keywords
   ↓
Calculate Demand Score
   ├─ Log-scaled reviews
   └─ Normalized rating
   ↓
Calculate Trust Score
   ├─ Rating threshold
   ├─ Review threshold
   └─ Prime status
   ↓
Calculate Margin Score
   ├─ Unit price
   ├─ Category multiplier
   └─ Margin estimation
   ↓
Weighted Sum → Final Score
```

## Database Schema

### Products Table

**Primary Keys & Indexes**:
- `id`: Auto-increment primary key
- `asin`: Unique index
- `url`: Unique index
- `normalized_url`: Index
- `normalized_title`: Index
- `final_score`: Descending index

**Deduplication Fields**:
- `asin`, `normalized_url`, `normalized_title`
- `last_seen_at` for TTL filtering

**Enrichment Fields**:
- `quantity_estimate`, `is_bulk`, `category`
- `ai_confidence_score`, `resale_suitability`

**Scoring Fields**:
- `bulk_score`, `demand_score`, `trust_score`, `unit_margin_score`
- `final_score`

**Tracking Fields**:
- `created_at`, `last_seen_at`, `source_run_id`

### Supporting Tables

**scraping_runs**: Run metadata and statistics
**deduplication_log**: Audit trail for duplicates
**ai_processing_queue**: Batch processing queue

## Configuration Management

### Environment Variables

All configuration via `.env` file:
- Database settings
- Scraper parameters
- AI model configuration
- Scoring weights
- Export settings

### Config Module

Centralized configuration in `config/config.js`:
- Type conversion (parseInt, parseFloat)
- Default values
- Validation
- Easy access throughout codebase

## Error Handling

### Levels

1. **Module Level**: Try-catch in each module
2. **Pipeline Level**: Run status tracking
3. **API Level**: HTTP error responses
4. **CLI Level**: Exit codes and error messages

### Strategies

- **Retry Logic**: Exponential backoff for transient errors
- **Graceful Degradation**: Continue on non-critical failures
- **Error Logging**: Comprehensive console logging
- **Run Tracking**: Error messages in database

## Performance Optimizations

1. **Scraper**:
   - Resource blocking (images, CSS)
   - Request interception
   - Rate limiting

2. **Database**:
   - Comprehensive indexing
   - Batch operations
   - Connection pooling

3. **AI Processing**:
   - Batch inference
   - Conditional processing (only when needed)
   - Timeout handling

4. **Memory**:
   - Streaming where possible
   - Cleanup after operations
   - Process isolation

## Scalability Considerations

### Current Limitations

- Single-threaded scraping
- Local SQLite database
- In-process AI model

### Scaling Options

1. **Horizontal**:
   - Multiple instances with separate databases
   - Load balancer for API
   - Distributed task queue

2. **Vertical**:
   - Increase memory for larger AI models
   - Faster storage (SSD)
   - More CPU cores

3. **Database**:
   - Migrate to PostgreSQL/MySQL
   - Read replicas
   - Sharding by region

4. **AI Processing**:
   - GPU acceleration
   - Separate AI service
   - Model quantization

## Security Considerations

### Current State

- No authentication
- Local-only database
- No encryption

### Production Recommendations

1. **API Security**:
   - API key authentication
   - Rate limiting per client
   - HTTPS/TLS

2. **Database**:
   - Encryption at rest
   - Access controls
   - Regular backups

3. **Scraping**:
   - Proxy rotation
   - CAPTCHA handling
   - Respect robots.txt

## Testing Strategy

### Unit Tests (Recommended)

- Deduplication logic
- Quantity extraction patterns
- Scoring calculations
- Normalization functions

### Integration Tests (Recommended)

- Database operations
- Pipeline execution
- API endpoints

### End-to-End Tests (Recommended)

- Full scraping workflow
- Export functionality
- CLI commands

## Monitoring & Observability

### Recommended Additions

1. **Logging**:
   - Structured logging (JSON)
   - Log aggregation (ELK stack)
   - Log levels (DEBUG, INFO, WARN, ERROR)

2. **Metrics**:
   - Scraping success rate
   - Deduplication rate
   - Average scores
   - Processing time

3. **Alerting**:
   - Failed runs
   - Database errors
   - AI model failures

## Deployment Architecture

### Development

```
Local Machine
├─ Node.js server
├─ SQLite database
├─ Chromium browser
└─ AI model (local)
```

### Production (Recommended)

```
Load Balancer
├─ API Server 1
│  ├─ Node.js
│  └─ Chromium
├─ API Server 2
│  ├─ Node.js
│  └─ Chromium
└─ Shared Services
   ├─ PostgreSQL Database
   ├─ AI Service (GPU)
   └─ File Storage (S3)
```

## Future Enhancements

1. **Real-time Updates**: WebSocket for live scraping progress
2. **Advanced Filtering**: Custom scoring weights per user
3. **Multi-region**: Support for all Amazon domains
4. **Image Analysis**: AI-based image classification
5. **Price Tracking**: Historical price data
6. **Competitor Analysis**: Cross-platform comparison
7. **Automated Alerts**: Notify on high-scoring products
8. **Dashboard**: Web UI for monitoring and management
