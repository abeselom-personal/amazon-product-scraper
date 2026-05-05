# API Documentation

## Base URL
```
http://localhost:3000/api
```

## Pipeline Endpoints

### 1. Scrape Single Keyword

Scrape Amazon UK for a single keyword and store results with AI classification and scoring.

**Endpoint**: `POST /pipeline/scrape`

**Request Body**:
```json
{
  "keyword": "bulk screws",
  "region": "UK",
  "maxPages": 3
}
```

**Parameters**:
- `keyword` (string, required): Search keyword
- `region` (string, optional): Amazon region, default "UK"
- `maxPages` (number, optional): Maximum pages to scrape, default unlimited

**Response**:
```json
{
  "success": true,
  "runId": "uuid-here",
  "keyword": "bulk screws",
  "region": "UK",
  "stats": {
    "scraped": 48,
    "new": 45,
    "updated": 2,
    "deduplicated": 1
  },
  "runStats": {
    "total_products": 45,
    "unique_asins": 43,
    "avg_score": 0.542,
    "max_score": 0.876,
    "bulk_products": 38,
    "hardware_count": 35,
    "electronics_count": 5,
    "tools_count": 5
  }
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/pipeline/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "bulk screws",
    "region": "UK",
    "maxPages": 3
  }'
```

---

### 2. Scrape Multiple Keywords (Batch)

Scrape multiple keywords in sequence.

**Endpoint**: `POST /pipeline/scrape/batch`

**Request Body**:
```json
{
  "keywords": ["bulk screws", "office supplies", "hardware kits"],
  "region": "UK",
  "maxPages": 2
}
```

**Parameters**:
- `keywords` (array, required): Array of search keywords
- `region` (string, optional): Amazon region, default "UK"
- `maxPages` (number, optional): Maximum pages per keyword

**Response**:
```json
{
  "totalKeywords": 3,
  "successful": 3,
  "failed": 0,
  "totalProductsScraped": 144,
  "totalProductsNew": 138,
  "totalProductsUpdated": 6,
  "results": [
    {
      "runId": "uuid-1",
      "keyword": "bulk screws",
      "success": true,
      "stats": { ... }
    },
    ...
  ]
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/pipeline/scrape/batch \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["bulk screws", "office supplies"],
    "region": "UK",
    "maxPages": 2
  }'
```

---

### 3. Get Top Ranked Products

Retrieve top-ranked products by final score.

**Endpoint**: `GET /pipeline/products/top`

**Query Parameters**:
- `limit` (number, optional): Number of products to return, default 100

**Response**:
```json
{
  "products": [
    {
      "id": 1,
      "asin": "B08XYZ123",
      "title": "Bulk Pack of 500 Screws...",
      "price": 24.99,
      "quantity_estimate": 500,
      "unit_price": 0.05,
      "category": "hardware",
      "is_bulk": 1,
      "rating": 4.5,
      "review_count": 234,
      "prime_eligible": 1,
      "final_score": 0.876,
      "bulk_score": 0.95,
      "demand_score": 0.78,
      "trust_score": 0.85,
      "unit_margin_score": 0.92,
      "resale_suitability": "high",
      "ai_confidence_score": 0.89,
      "url": "https://amazon.co.uk/...",
      "created_at": "2024-01-15 10:30:00",
      "last_seen_at": "2024-01-15 10:30:00"
    },
    ...
  ],
  "count": 100
}
```

**Example**:
```bash
curl http://localhost:3000/api/pipeline/products/top?limit=50
```

---

### 4. Export Top Products to Excel

Export top-ranked products to Excel file.

**Endpoint**: `GET /pipeline/export/top`

**Query Parameters**:
- `limit` (number, optional): Number of products to export, default 100

**Response**:
```json
{
  "success": true,
  "filepath": "./exports/amazon_products_2024-01-15.xlsx",
  "filename": "amazon_products_2024-01-15.xlsx",
  "productCount": 100
}
```

**Example**:
```bash
curl http://localhost:3000/api/pipeline/export/top?limit=100
```

---

### 5. Export Products by Category

Export products filtered by category.

**Endpoint**: `GET /pipeline/export/category/:category`

**Path Parameters**:
- `category` (string, required): Category name (hardware, electronics, tools, office_supplies, misc)

**Query Parameters**:
- `limit` (number, optional): Number of products to export, default 100

**Response**:
```json
{
  "success": true,
  "filepath": "./exports/amazon_hardware_2024-01-15.xlsx",
  "filename": "amazon_hardware_2024-01-15.xlsx",
  "productCount": 75
}
```

**Example**:
```bash
curl http://localhost:3000/api/pipeline/export/category/hardware?limit=50
```

---

### 6. Get Run History

Retrieve scraping run history.

**Endpoint**: `GET /pipeline/runs`

**Query Parameters**:
- `limit` (number, optional): Number of runs to return, default 10

**Response**:
```json
{
  "runs": [
    {
      "id": "uuid-here",
      "keyword": "bulk screws",
      "region": "UK",
      "started_at": "2024-01-15 10:30:00",
      "completed_at": "2024-01-15 10:35:00",
      "status": "completed",
      "products_scraped": 48,
      "products_new": 45,
      "products_updated": 2,
      "products_deduplicated": 1,
      "error_message": null
    },
    ...
  ],
  "count": 10
}
```

**Example**:
```bash
curl http://localhost:3000/api/pipeline/runs?limit=20
```

---

### 7. Get Run Statistics

Get detailed statistics for a specific scraping run.

**Endpoint**: `GET /pipeline/runs/:runId`

**Path Parameters**:
- `runId` (string, required): Run UUID

**Response**:
```json
{
  "run": {
    "id": "uuid-here",
    "keyword": "bulk screws",
    "region": "UK",
    "started_at": "2024-01-15 10:30:00",
    "completed_at": "2024-01-15 10:35:00",
    "status": "completed",
    "products_scraped": 48,
    "products_new": 45,
    "products_updated": 2,
    "products_deduplicated": 1
  },
  "topProducts": [
    {
      "id": 1,
      "title": "...",
      "final_score": 0.876,
      ...
    },
    ...
  ]
}
```

**Example**:
```bash
curl http://localhost:3000/api/pipeline/runs/abc123-uuid-here
```

---

## Legacy Endpoint

### Scrape (Legacy)

Original scraping endpoint (preserved for backward compatibility).

**Endpoint**: `GET /scrape`

**Query Parameters**:
- `keyword` (string, required): Search keyword
- `region` (string, optional): Amazon region
- `page` (number, optional): Page number

**Response**:
```json
{
  "products": [...],
  "currentPage": 1,
  "totalPages": 10
}
```

**Note**: This endpoint does NOT use the new pipeline features (no deduplication, AI classification, or scoring).

---

## Error Responses

All endpoints return standard error responses:

**400 Bad Request**:
```json
{
  "error": "Keyword is required"
}
```

**404 Not Found**:
```json
{
  "error": "Run not found"
}
```

**500 Internal Server Error**:
```json
{
  "error": "Failed to execute scrape",
  "details": "Detailed error message"
}
```

---

## Rate Limiting

The scraper implements internal rate limiting:
- Default: 1000ms between requests
- Configurable via `RATE_LIMIT_MS` environment variable
- Applies to all scraping operations

---

## Best Practices

1. **Batch Scraping**: Use `/pipeline/scrape/batch` for multiple keywords
2. **Pagination**: Limit `maxPages` to avoid long-running requests (recommend 3-5 pages)
3. **Export**: Export results after scraping completes
4. **Monitoring**: Check `/pipeline/runs` for run history and status
5. **Error Handling**: Implement retry logic for 500 errors

---

## Example Workflow

```bash
# 1. Scrape products
curl -X POST http://localhost:3000/api/pipeline/scrape \
  -H "Content-Type: application/json" \
  -d '{"keyword":"bulk hardware","region":"UK","maxPages":3}'

# Response: {"success":true,"runId":"abc123...",...}

# 2. Get top products
curl http://localhost:3000/api/pipeline/products/top?limit=20

# 3. Export to Excel
curl http://localhost:3000/api/pipeline/export/top?limit=100

# 4. Check run details
curl http://localhost:3000/api/pipeline/runs/abc123...
```

---

## Authentication

Currently, no authentication is required. For production deployment, implement:
- API key authentication
- Rate limiting per client
- IP whitelisting
- HTTPS/TLS encryption
