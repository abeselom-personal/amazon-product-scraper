const fs = require('fs');

function detectChromium() {
    const candidates = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ];
    for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch (_) {}
    }
    return '/usr/bin/chromium';
}

module.exports = {
    database: {
        path: process.env.DB_PATH || './data/products.db',
        deduplicationTTL: parseInt(process.env.DEDUP_TTL_DAYS || '7', 10) * 24 * 60 * 60 * 1000,
    },
    
    scraper: {
        chromiumPath: process.env.CHROMIUM_PATH || detectChromium(),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
        retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '2000', 10),
        rateLimitDelayMs: parseInt(process.env.RATE_LIMIT_MS || '1000', 10),
        timeout: parseInt(process.env.SCRAPER_TIMEOUT || '60000', 10),
        userAgents: [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
        ]
    },
    
    ai: {
        provider: process.env.AI_PROVIDER || 'google',
        modelPath: process.env.AI_MODEL_PATH || './models/qwen2.5-small',
        batchSize: parseInt(process.env.AI_BATCH_SIZE || '5', 10),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '512', 10),
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
        confidenceThreshold: parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || '0.7'),
        google: {
            apiKey: process.env.GOOGLE_AI_STUDIO_API_KEY || '',
            model: process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash',
            timeoutMs: parseInt(process.env.GOOGLE_AI_TIMEOUT_MS || '30000', 10),
            maxRetries: parseInt(process.env.GOOGLE_AI_MAX_RETRIES || '5', 10),
            useImage: (process.env.GOOGLE_AI_USE_IMAGE || 'true') === 'true',
            // Keep this conservative by default to reduce rate-limit risk.
            rpm: parseInt(process.env.GOOGLE_AI_RPM || '10', 10),
            maxConcurrency: parseInt(process.env.GOOGLE_AI_MAX_CONCURRENCY || '2', 10),
            // After a 429, pause ALL requests this long if the API didn't return a retryDelay
            defaultCooldownMs: parseInt(process.env.GOOGLE_AI_DEFAULT_COOLDOWN_MS || '60000', 10),
            // Stop calling Gemini for the rest of the run after this many consecutive 429s
            maxConsecutive429: parseInt(process.env.GOOGLE_AI_MAX_CONSECUTIVE_429 || '5', 10),
        },
    },

    filters: {
        minimumPriceGBP: parseFloat(process.env.MINIMUM_PRODUCT_PRICE_GBP || '1'),
        enableMinimumPrice: (process.env.ENABLE_MIN_PRICE_FILTER || 'true') === 'true',
        maximumPriceGBP: parseFloat(process.env.MAXIMUM_PRODUCT_PRICE_GBP || '15'),
        enableMaximumPrice: (process.env.ENABLE_MAX_PRICE_FILTER || 'true') === 'true',
        maxShippableWeightGrams: parseFloat(process.env.MAX_SHIPPABLE_WEIGHT_GRAMS || '100'),
    },

    categories: {
        enabled: (process.env.CATEGORIES_ENABLED || 'Misc,Hardware').split(',').map(s => s.trim()).filter(Boolean),
        // Map a logical category to an Amazon UK browse-node search URL or keyword list.
        // Each entry can have a 'rh' (browse-node filter) and/or 'keywords' array.
        sources: {
            Hardware: {
                browseNodeUK: 'n:11052681',
                keywords: ['hardware bulk pack', 'screws bulk pack', 'bolts pack', 'fasteners pack', 'nails bulk'],
            },
            Misc: {
                browseNodeUK: null,
                keywords: ['bulk lot wholesale', 'joblot pallet', 'wholesale clearance lot', 'liquidation lot'],
            },
        },
    },

    productDetail: {
        // When true, visit each product detail page to gather full image gallery (slow but accurate)
        fetchPDPImages: (process.env.FETCH_PDP_IMAGES || 'false') === 'true',
        maxImagesPerProduct: parseInt(process.env.MAX_IMAGES_PER_PRODUCT || '6', 10),
    },
    
    scoring: {
        weights: {
            bulk: parseFloat(process.env.WEIGHT_BULK || '0.30'),
            demand: parseFloat(process.env.WEIGHT_DEMAND || '0.25'),
            trust: parseFloat(process.env.WEIGHT_TRUST || '0.20'),
            unitMargin: parseFloat(process.env.WEIGHT_UNIT_MARGIN || '0.25'),
        },
        categoryMultipliers: {
            hardware: { min: 2.0, max: 5.0 },
            electronics: { min: 1.5, max: 3.0 },
            office_supplies: { min: 1.5, max: 2.0 },
            tools: { min: 2.0, max: 4.0 },
            misc: { min: 1.2, max: 2.0 },
        },
        bulkThresholds: {
            high: 100,
            medium: 20,
            low: 5,
        },
        trustThresholds: {
            minRating: 4.3,
            minReviews: 100,
        },
    },
    
    export: {
        topN: parseInt(process.env.EXPORT_TOP_N || '100', 10),
        outputPath: process.env.EXPORT_PATH || './exports',
    },
    
    amazon: {
        domains: {
            UK: 'https://www.amazon.co.uk',
            US: 'https://www.amazon.com',
        },
        defaultRegion: 'UK',
    },
};
