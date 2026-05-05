-- Products table with comprehensive deduplication support
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asin TEXT UNIQUE,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    price REAL,
    rating REAL,
    review_count INTEGER DEFAULT 0,
    url TEXT UNIQUE NOT NULL,
    normalized_url TEXT NOT NULL,
    quantity_estimate INTEGER,
    is_bulk BOOLEAN DEFAULT 0,
    category TEXT,
    ai_confidence_score REAL,
    resale_score REAL,
    unit_price REAL,
    image_url TEXT,
    images TEXT,                    -- JSON array of all scraped image URLs
    description TEXT,
    region TEXT DEFAULT 'UK',
    prime_eligible BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source_run_id TEXT,
    source_category TEXT,           -- Category used during scraping (e.g. Hardware, Misc)
    
    -- Metadata fields
    ai_classification TEXT,
    ai_notes TEXT,
    ai_summary TEXT,                -- Short reasoning from AI
    ai_signals TEXT,                -- JSON array of bulk/resale signals
    ai_is_resellable INTEGER,       -- 0/1
    ai_estimated_total_weight_grams REAL,
    ai_estimated_unit_weight_grams REAL,
    ai_recommended_resale_pack_quantity INTEGER,
    ai_estimated_resale_pack_weight_grams REAL,
    ai_is_resale_pack_shippable_under_100g INTEGER,
    ai_estimated_weight_grams REAL, -- AI estimated product/package weight
    ai_is_shippable_under_100g INTEGER, -- 0/1 based on <=100g shipping viability
    ai_provider TEXT,               -- 'google' | 'mock'
    ai_processed_at DATETIME,
    resale_suitability TEXT,
    
    -- Scoring components
    bulk_score REAL,
    demand_score REAL,
    trust_score REAL,
    unit_margin_score REAL,
    shipping_score REAL,
    final_score REAL
);

-- Indexes for deduplication and performance
CREATE INDEX IF NOT EXISTS idx_products_asin ON products(asin);
CREATE INDEX IF NOT EXISTS idx_products_url ON products(url);
CREATE INDEX IF NOT EXISTS idx_products_normalized_url ON products(normalized_url);
CREATE INDEX IF NOT EXISTS idx_products_normalized_title ON products(normalized_title);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_products_source_run ON products(source_run_id);
CREATE INDEX IF NOT EXISTS idx_products_final_score ON products(final_score DESC);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- Scraping runs tracking
CREATE TABLE IF NOT EXISTS scraping_runs (
    id TEXT PRIMARY KEY,
    keyword TEXT NOT NULL,
    region TEXT NOT NULL,
    category TEXT,                              -- e.g. Hardware, Misc, or NULL for keyword-only
    run_type TEXT DEFAULT 'keyword',            -- 'keyword' | 'category' | 'batch'
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    status TEXT DEFAULT 'running',
    products_scraped INTEGER DEFAULT 0,
    products_new INTEGER DEFAULT 0,
    products_updated INTEGER DEFAULT 0,
    products_deduplicated INTEGER DEFAULT 0,
    products_filtered INTEGER DEFAULT 0,        -- filtered out by min-price, etc.
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_started ON scraping_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON scraping_runs(status);

-- Deduplication log for tracking
CREATE TABLE IF NOT EXISTS deduplication_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    duplicate_of_id INTEGER NOT NULL,
    match_type TEXT NOT NULL,
    match_confidence REAL,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (duplicate_of_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_dedup_product ON deduplication_log(product_id);
CREATE INDEX IF NOT EXISTS idx_dedup_duplicate ON deduplication_log(duplicate_of_id);

-- AI processing queue for batch processing
CREATE TABLE IF NOT EXISTS ai_processing_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_queue_status ON ai_processing_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_ai_queue_product ON ai_processing_queue(product_id);
