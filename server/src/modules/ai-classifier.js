/**
 * AI Classifier
 * - Provider: Google AI Studio (Gemini) by default; falls back to local mock if no API key.
 * - Sends product title, description, price, category, and at least one image to the model.
 * - Returns a normalized JSON: { is_bulk, is_resellable, confidence, category_prediction, summary, signals, ... }
 *
 * Designed to remain modular: swap providers via config.ai.provider without changing pipeline code.
 */

const config = require('../config/config');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const VALID_INTERNAL_CATEGORIES = ['electronics', 'hardware', 'office_supplies', 'tools', 'misc'];

// ----- Concurrency / rate-limiting primitives -----

class TokenBucket {
    constructor(rpm) {
        this.capacity = Math.max(1, rpm);
        this.tokens = this.capacity;
        this.intervalMs = 60_000 / this.capacity;
        this.lastRefill = Date.now();
        this.waiters = [];
    }
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        if (elapsed <= 0) return;
        const refill = elapsed / this.intervalMs;
        if (refill >= 1) {
            this.tokens = Math.min(this.capacity, this.tokens + Math.floor(refill));
            this.lastRefill = now - ((elapsed % this.intervalMs) | 0);
        }
    }
    async acquire() {
        while (true) {
            this.refill();
            if (this.tokens >= 1) {
                this.tokens -= 1;
                return;
            }
            const waitMs = Math.max(50, this.intervalMs - (Date.now() - this.lastRefill));
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    /** Force the bucket to be empty until `untilTs` (used after 429 cooldowns). */
    holdUntil(untilTs) {
        this.tokens = 0;
        this.lastRefill = untilTs;
    }
}

class Semaphore {
    constructor(max) {
        this.max = Math.max(1, max);
        this.active = 0;
        this.queue = [];
    }
    async acquire() {
        if (this.active < this.max) { this.active++; return; }
        await new Promise(resolve => this.queue.push(resolve));
        this.active++;
    }
    release() {
        this.active--;
        const next = this.queue.shift();
        if (next) next();
    }
}

class AIClassifier {
    constructor() {
        this.isInitialized = false;
        this.provider = config.ai.provider || 'google';
        this.baseProvider = this.provider;
        this.imageCache = new Map(); // url -> { mime, base64 }

        // Rate limiting state (initialized in initialize())
        this.bucket = null;
        this.semaphore = null;
        this.cooldownUntil = 0;       // global pause timestamp (ms)
        this.consecutive429 = 0;       // consecutive 429s — trips circuit breaker
        this.circuitOpen = false;      // when true, bypass Gemini and use fallback for the rest of the run
        this.quotaExhausted = false;
        this.loggedCircuitNotice = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        if (this.provider === 'google') {
            const key = config.ai.google.apiKey;
            if (!key) {
                console.warn('[AI] GOOGLE_AI_STUDIO_API_KEY missing — falling back to mock provider');
                this.provider = 'mock';
            } else {
                const g = config.ai.google;
                this.bucket = new TokenBucket(g.rpm);
                this.semaphore = new Semaphore(g.maxConcurrency);
                this.cooldownUntil = 0;
                this.consecutive429 = 0;
                this.circuitOpen = false;
                console.log(`[AI] Provider: Google AI Studio (${g.model}) · ${g.rpm} RPM · concurrency=${g.maxConcurrency}`);
            }
        } else {
            console.log(`[AI] Provider: ${this.provider}`);
        }

        // Keep reset behavior aligned with the resolved provider mode.
        this.baseProvider = this.provider;

        this.isInitialized = true;
    }

    resetCircuit() {
        this.cooldownUntil = 0;
        this.consecutive429 = 0;
        this.circuitOpen = false;
        this.quotaExhausted = false;
        this.loggedCircuitNotice = false;
        this.provider = this.baseProvider;
    }

    // ---------------- Prompt building ----------------

    buildPrompt(product) {
        const desc = product.description ? `\n- Description: ${product.description.substring(0, 500)}` : '';
        const cat = product.source_category || product.category || 'unspecified';
        const reviews = product.review_count != null ? product.review_count : 'N/A';
        return `You are a product validation AI for a bulk reselling business in the UK.

Analyze the provided product (title, price, category, image) and decide whether it is a BULK-RESELLABLE item.

Also validate UK small-post viability for RESALE:
- Do NOT judge only by the full purchased pack weight.
- If the product is divisible (example: screws/bolts/cable-ties), estimate a realistic resale sub-pack quantity and weight.
- A product passes shipping if a practical resale sub-pack can be shipped via post at <= ${config.filters.maxShippableWeightGrams} grams.
- If it cannot be split practically, treat the whole item as one resale pack.

A product qualifies as BULK-RESELLABLE if:
- The packaging or photo shows multi-pack / bulk / commercial / industrial packaging
- It contains identical, divisible units (screws, cables, batteries, bolts, fasteners, etc.)
- Smaller quantities can be repackaged and resold profitably
- It is non-perishable, not brand-restricted, and not a single-integrated product

Reject as NOT bulk-resellable if:
- It is a single integrated item (TV, laptop, single tool)
- Perishable / hygiene / regulated
- Photo shows only one unit and there is no multi-pack indication

Product information:
- Title: ${product.title || ''}
- Price: £${product.price != null ? Number(product.price).toFixed(2) : 'N/A'}
- Source category: ${cat}
- Rating: ${product.rating != null ? product.rating : 'N/A'}
- Review count: ${reviews}${desc}

Use the image (if provided) as primary visual evidence.

Return STRICT JSON ONLY (no markdown, no commentary) with this exact shape:
{
  "is_bulk": true|false,
  "is_resellable": true|false,
  "confidence": 0.0-1.0,
  "category_prediction": "Hardware"|"Electronics"|"Tools"|"Office"|"Misc",
  "summary": "one short sentence",
  "signals": ["multi-pack", "commercial packaging", "..."],
  "quantity": number|null,
  "estimated_total_weight_grams": number|null,
  "estimated_unit_weight_grams": number|null,
  "recommended_resale_pack_quantity": number|null,
  "estimated_resale_pack_weight_grams": number|null,
  "is_resale_pack_shippable_under_100g": true|false|null,
  "resale_suitability": "high"|"medium"|"low"
}`;
    }

    // ---------------- Image fetching ----------------

    async fetchImageAsBase64(url) {
        if (!url) return null;
        if (this.imageCache.has(url)) return this.imageCache.get(url);

        try {
            const data = await this.httpGetBuffer(url, 8000);
            if (!data) return null;
            const mime = this.guessMimeType(url, data);
            if (!mime) return null;
            const result = { mime, base64: data.toString('base64') };
            // Limit cache size
            if (this.imageCache.size > 200) {
                const firstKey = this.imageCache.keys().next().value;
                this.imageCache.delete(firstKey);
            }
            this.imageCache.set(url, result);
            return result;
        } catch (err) {
            console.warn(`[AI] Image fetch failed (${url}):`, err.message);
            return null;
        }
    }

    guessMimeType(url, buffer) {
        const lower = url.toLowerCase();
        if (lower.match(/\.png(\?|$)/)) return 'image/png';
        if (lower.match(/\.webp(\?|$)/)) return 'image/webp';
        if (lower.match(/\.gif(\?|$)/)) return 'image/gif';
        if (lower.match(/\.jpe?g(\?|$)/)) return 'image/jpeg';
        if (buffer && buffer.length > 4) {
            if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
            if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
            if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
            if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
        }
        return 'image/jpeg';
    }

    httpGetBuffer(url, timeoutMs = 10000, redirectsLeft = 3) {
        return new Promise((resolve, reject) => {
            let parsed;
            try { parsed = new URL(url); } catch (e) { return reject(e); }
            const lib = parsed.protocol === 'http:' ? http : https;
            const req = lib.get(parsed, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductDiscovery/1.0)' } }, (res) => {
                if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
                    res.resume();
                    const next = new URL(res.headers.location, parsed).toString();
                    return this.httpGetBuffer(next, timeoutMs, redirectsLeft - 1).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                let total = 0;
                res.on('data', (c) => {
                    chunks.push(c);
                    total += c.length;
                    if (total > 8 * 1024 * 1024) {
                        req.destroy(new Error('Image too large'));
                    }
                });
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            });
            req.on('timeout', () => { req.destroy(new Error('timeout')); });
            req.on('error', reject);
        });
    }

    // ---------------- Google AI Studio (Gemini) ----------------

    parseRetryDelayMs(errMessage) {
        // Gemini 429 responses include a JSON body containing details[].retryInfo.retryDelay = "Ns"
        if (!errMessage) return null;
        try {
            const jsonStart = errMessage.indexOf('{');
            if (jsonStart < 0) return null;
            const body = JSON.parse(errMessage.slice(jsonStart));
            const details = body?.error?.details || [];
            for (const d of details) {
                if (d?.retryDelay) {
                    const m = String(d.retryDelay).match(/(\d+(?:\.\d+)?)s/);
                    if (m) return Math.ceil(parseFloat(m[1]) * 1000);
                }
            }
        } catch (_) { /* fall through */ }
        // Fallback: look for "retryDelay":"Ns" anywhere in the string
        const m = errMessage.match(/retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s/);
        if (m) return Math.ceil(parseFloat(m[1]) * 1000);
        return null;
    }

    isRateLimit(err) {
        const msg = err?.message || '';
        return msg.startsWith('HTTP 429') || /\bquota\b|\brate.?limit\b/i.test(msg);
    }

    isHardQuotaExceeded(err) {
        const msg = err?.message || '';
        return /exceeded your current quota|resource_exhausted|quota exceeded|billing/i.test(msg);
    }

    isNonRetryableGeminiError(err) {
        const msg = err?.message || '';
        return msg.startsWith('HTTP 400') || msg.startsWith('HTTP 401') || msg.startsWith('HTTP 403') || msg.startsWith('HTTP 404');
    }

    async waitForCooldown() {
        const now = Date.now();
        if (this.cooldownUntil > now) {
            const ms = this.cooldownUntil - now;
            await this.delay(ms);
        }
    }

    async callGemini(product) {
        if (this.circuitOpen) {
            // Circuit breaker is open — short-circuit to fallback without attempting the API.
            throw new Error('Gemini circuit breaker open (too many consecutive 429s)');
        }

        const key = config.ai.google.apiKey;
        const g = config.ai.google;
        const model = g.model;
        const prompt = this.buildPrompt(product);

        const parts = [{ text: prompt }];
        if (g.useImage) {
            const candidateImage = (Array.isArray(product.images) && product.images[0]) || product.image_url;
            if (candidateImage) {
                const img = await this.fetchImageAsBase64(candidateImage);
                if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.base64 } });
            }
        }

        const body = {
            contents: [{ parts }],
            generationConfig: {
                temperature: config.ai.temperature,
                responseMimeType: 'application/json',
                maxOutputTokens: 1024,
            },
        };

        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

        await this.semaphore.acquire();
        try {
            for (let attempt = 0; attempt <= g.maxRetries; attempt++) {
                // Honor any active cooldown BEFORE attempting (covers concurrent callers).
                await this.waitForCooldown();
                if (this.circuitOpen) throw new Error('Gemini circuit breaker open');

                // Always pass through the rate-limit bucket.
                await this.bucket.acquire();

                try {
                    const response = await this.httpJsonPost(endpoint, body, g.timeoutMs);
                    const text = response?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
                    if (!text) throw new Error('Gemini returned empty content');

                    // Success — reset 429 counter
                    this.consecutive429 = 0;
                    return text;
                } catch (err) {
                    const isRL = this.isRateLimit(err);
                    if (isRL) {
                        if (this.isHardQuotaExceeded(err)) {
                            this.circuitOpen = true;
                            this.quotaExhausted = true;
                            this.cooldownUntil = Date.now() + (60 * 60 * 1000);
                            this.bucket.holdUntil(this.cooldownUntil);
                            console.warn('[AI] Gemini quota exhausted — switching to local mock provider for this run.');
                            throw err;
                        }

                        this.consecutive429++;
                        const hint = this.parseRetryDelayMs(err.message) || g.defaultCooldownMs;
                        const cooldown = Math.min(hint, 5 * 60_000); // hard cap 5 min
                        const newCooldown = Date.now() + cooldown;

                        if (newCooldown > this.cooldownUntil) {
                            this.cooldownUntil = newCooldown;
                            this.bucket.holdUntil(newCooldown);
                        }

                        if (this.consecutive429 >= g.maxConsecutive429) {
                            this.circuitOpen = true;
                            console.warn(`[AI] Gemini circuit breaker OPEN after ${this.consecutive429} consecutive 429s — using fallback for the rest of the run.`);
                            throw err;
                        }

                        if (attempt < g.maxRetries) {
                            console.warn(`[AI] Gemini 429 (attempt ${attempt + 1}/${g.maxRetries + 1}). Cooldown ${Math.round(cooldown / 1000)}s (consec=${this.consecutive429}/${g.maxConsecutive429}).`);
                            continue; // retry
                        }
                        throw err;
                    }

                    if (this.isNonRetryableGeminiError(err)) {
                        this.circuitOpen = true;
                        console.warn('[AI] Gemini non-retryable error — opening circuit breaker for this run and using fallback classification.');
                        throw err;
                    }

                    // Non-rate-limit error: short exponential backoff
                    if (attempt < g.maxRetries) {
                        const delayMs = Math.min(8000, 1000 * Math.pow(2, attempt));
                        const msg = String(err?.message || err || '').substring(0, 200);
                        console.warn(`[AI] Gemini error (attempt ${attempt + 1}/${g.maxRetries + 1}): ${msg || 'unknown error'}. Retrying in ${delayMs}ms.`);
                        await this.delay(delayMs);
                        continue;
                    }
                    throw err;
                }
            }
            throw new Error('Unreachable');
        } finally {
            this.semaphore.release();
        }
    }

    httpJsonPost(url, payload, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            let parsed;
            try { parsed = new URL(url); } catch (e) { return reject(e); }
            const data = JSON.stringify(payload);
            const opts = {
                method: 'POST',
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                port: parsed.port || 443,
                timeout: timeoutMs,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            };
            const lib = parsed.protocol === 'http:' ? http : https;
            const req = lib.request(opts, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        return reject(new Error(`HTTP ${res.statusCode}: ${text.substring(0, 300)}`));
                    }
                    try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
                });
                res.on('error', reject);
            });
            req.on('timeout', () => { req.destroy(new Error('timeout')); });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    // ---------------- Parsing & normalization ----------------

    parseAIResponse(text) {
        try {
            const cleaned = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            let parsed = null;

            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            } else {
                parsed = this.parseLooseKeyValueResponse(cleaned);
            }

            if (!parsed || typeof parsed !== 'object') {
                throw new Error('No structured object found in AI response');
            }

            return this.normalize(parsed);
        } catch (err) {
            const snippet = String(text || '').replace(/\s+/g, ' ').trim().substring(0, 240);
            console.warn('[AI] Parse error:', err.message, snippet ? `| raw="${snippet}"` : '');
            return null;
        }
    }

    parseLooseKeyValueResponse(text) {
        if (!text) return null;

        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const output = {};

        for (const line of lines) {
            const kv = line.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*[:=]\s*(.+)$/);
            if (!kv) continue;

            const key = kv[1];
            let value = kv[2].trim();
            value = value.replace(/^["']|["']$/g, '');
            value = value.replace(/,$/, '').trim();

            if (/^(true|false)$/i.test(value)) {
                output[key] = /^true$/i.test(value);
                continue;
            }
            if (/^(null|none|n\/a)$/i.test(value)) {
                output[key] = null;
                continue;
            }
            if (/^-?\d+(?:\.\d+)?$/.test(value)) {
                output[key] = Number(value);
                continue;
            }
            if (/^\[.*\]$/.test(value)) {
                try {
                    output[key] = JSON.parse(value.replace(/'/g, '"'));
                    continue;
                } catch (_) {}
            }
            output[key] = value;
        }

        return Object.keys(output).length > 0 ? output : null;
    }

    normalize(parsed) {
        const categoryPredictionRaw = (parsed.category_prediction || parsed.category || 'misc').toString().toLowerCase();
        const categoryMap = {
            hardware: 'hardware',
            electronics: 'electronics',
            tools: 'tools',
            office: 'office_supplies',
            office_supplies: 'office_supplies',
            misc: 'misc',
        };
        const internalCategory = categoryMap[categoryPredictionRaw] ||
            (VALID_INTERNAL_CATEGORIES.includes(categoryPredictionRaw) ? categoryPredictionRaw : 'misc');

        const conf = Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0.5));
        const isBulk = Boolean(parsed.is_bulk);
        const isResellable = parsed.is_resellable !== undefined
            ? Boolean(parsed.is_resellable)
            : isBulk;

        const validSuitability = ['high', 'medium', 'low'];
        const suitabilityRaw = (parsed.resale_suitability || (isResellable ? (isBulk ? 'high' : 'medium') : 'low')).toString().toLowerCase();
        const suitability = validSuitability.includes(suitabilityRaw) ? suitabilityRaw : 'medium';

        const signals = Array.isArray(parsed.signals)
            ? parsed.signals.map(s => String(s).substring(0, 60)).slice(0, 12)
            : [];

        const quantity = parsed.quantity != null && !isNaN(parsed.quantity) ? parseInt(parsed.quantity, 10) : null;
        const rawTotalWeight = parsed.estimated_total_weight_grams ?? parsed.estimated_weight_grams;
        const estimatedTotalWeightGrams = rawTotalWeight != null && !isNaN(rawTotalWeight)
            ? Math.max(0, parseFloat(rawTotalWeight))
            : null;
        const rawUnitWeight = parsed.estimated_unit_weight_grams;
        const estimatedUnitWeightGrams = rawUnitWeight != null && !isNaN(rawUnitWeight)
            ? Math.max(0, parseFloat(rawUnitWeight))
            : null;
        const rawResaleQty = parsed.recommended_resale_pack_quantity;
        const recommendedResalePackQuantity = rawResaleQty != null && !isNaN(rawResaleQty)
            ? Math.max(1, parseInt(rawResaleQty, 10))
            : null;
        const rawResalePackWeight = parsed.estimated_resale_pack_weight_grams;
        let estimatedResalePackWeightGrams = rawResalePackWeight != null && !isNaN(rawResalePackWeight)
            ? Math.max(0, parseFloat(rawResalePackWeight))
            : null;
        if (estimatedResalePackWeightGrams == null && estimatedUnitWeightGrams != null && recommendedResalePackQuantity != null) {
            estimatedResalePackWeightGrams = estimatedUnitWeightGrams * recommendedResalePackQuantity;
        }
        const rawShippable = parsed.is_resale_pack_shippable_under_100g ?? parsed.is_shippable_under_100g;
        let isResalePackShippableUnder100g = null;
        if (rawShippable !== null && rawShippable !== undefined) {
            const s = String(rawShippable).trim().toLowerCase();
            if (s === 'true' || s === '1' || s === 'yes') isResalePackShippableUnder100g = true;
            else if (s === 'false' || s === '0' || s === 'no') isResalePackShippableUnder100g = false;
            else isResalePackShippableUnder100g = Boolean(rawShippable);
        }
        if (isResalePackShippableUnder100g == null && estimatedResalePackWeightGrams != null) {
            isResalePackShippableUnder100g = estimatedResalePackWeightGrams <= config.filters.maxShippableWeightGrams;
        }

        if (isResalePackShippableUnder100g === true && !signals.some(s => /100g|lightweight|small post|postable/i.test(s))) {
            signals.push('resale pack under-100g shippable');
        }
        if (isResalePackShippableUnder100g === false && !signals.some(s => /over-100g|heavy|parcel/i.test(s))) {
            signals.push('resale pack over-100g estimated');
        }

        return {
            // Spec-required output keys (mirrored on top-level for API consumers)
            is_bulk: isBulk,
            is_resellable: isResellable,
            confidence: conf,
            category_prediction: this.toDisplayCategory(internalCategory),
            summary: String(parsed.summary || '').substring(0, 280),
            signals,

            // Internal pipeline fields
            quantity,
            estimated_total_weight_grams: estimatedTotalWeightGrams,
            estimated_unit_weight_grams: estimatedUnitWeightGrams,
            recommended_resale_pack_quantity: recommendedResalePackQuantity,
            estimated_resale_pack_weight_grams: estimatedResalePackWeightGrams,
            is_resale_pack_shippable_under_100g: isResalePackShippableUnder100g,
            // backward-compatible aliases
            estimated_weight_grams: estimatedResalePackWeightGrams,
            is_shippable_under_100g: isResalePackShippableUnder100g,
            category: internalCategory,
            resale_suitability: suitability,
            notes: String(parsed.summary || parsed.notes || '').substring(0, 500),
        };
    }

    toDisplayCategory(internal) {
        const map = {
            hardware: 'Hardware',
            electronics: 'Electronics',
            tools: 'Tools',
            office_supplies: 'Office',
            misc: 'Misc',
        };
        return map[internal] || 'Misc';
    }

    // ---------------- Public API ----------------

    async classifyProduct(product) {
        if (!this.isInitialized) await this.initialize();

        if (this.provider === 'google' && this.circuitOpen) {
            if (!this.loggedCircuitNotice) {
                const reason = this.quotaExhausted ? 'quota exhausted' : 'rate-limit circuit open';
                console.warn(`[AI] Gemini unavailable (${reason}) — using mock classifier for remaining products in this run.`);
                this.loggedCircuitNotice = true;
            }
            const parsed = this.parseAIResponse(this.generateMockResponse(product));
            return parsed ? { ...parsed, ai_provider: 'mock' } : this.getFallbackClassification(product);
        }

        try {
            let raw;
            let provider = this.provider;

            if (this.provider === 'google') {
                raw = await this.callGemini(product);
            } else {
                raw = this.generateMockResponse(product);
                provider = 'mock';
            }

            const parsed = this.parseAIResponse(raw);
            if (!parsed) return this.getFallbackClassification(product);

            return { ...parsed, ai_provider: provider };
        } catch (err) {
            if (this.isHardQuotaExceeded(err)) {
                this.circuitOpen = true;
                this.quotaExhausted = true;
                const parsed = this.parseAIResponse(this.generateMockResponse(product));
                return parsed ? { ...parsed, ai_provider: 'mock' } : this.getFallbackClassification(product);
            }
            console.error('[AI] Classification error:', err.message);
            return this.getFallbackClassification(product);
        }
    }

    async classifyBatch(products) {
        if (!this.isInitialized) await this.initialize();
        // Fresh chance for the new batch — clear any lingering circuit-breaker state from a previous run.
        if (this.provider === 'google') this.resetCircuit();

        console.log(`[AI] Classifying batch of ${products.length} products via ${this.provider}`);

        let done = 0;
        const results = await Promise.all(products.map(async (p) => {
            const r = await this.classifyProduct(p);
            done++;
            if (done % 10 === 0 || done === products.length) {
                console.log(`[AI] Progress: ${done}/${products.length} (circuit=${this.circuitOpen ? 'OPEN' : 'closed'})`);
            }
            return r;
        }));
        return results;
    }

    generateMockResponse(product) {
        const text = (product.title || '').toLowerCase();
        let internal = 'misc';
        if (/screw|nail|bolt|nut|fastener|hardware/.test(text)) internal = 'hardware';
        else if (/cable|usb|charger|battery|electronic/.test(text)) internal = 'electronics';
        else if (/drill|hammer|tool|wrench|saw/.test(text)) internal = 'tools';
        else if (/pen|notebook|paper|office/.test(text)) internal = 'office_supplies';

        const isBulk = /\b(pack|set|bulk|box|case|lot|wholesale|joblot|pallet|liquidation|industrial|commercial|multi-?pack|x\s*\d+|\d+\s*pcs?|\d+\s*pack)\b/.test(text);
        const m = text.match(/(\d+)\s*(pack|pcs|pieces|count|ct)/i) || text.match(/pack\s+of\s+(\d+)/i) || text.match(/(\d+)\s*x\b/);
        const quantity = m ? parseInt(m[1], 10) : null;
        const heavyHint = /cast\s*iron|steel|hammer|drill|anvil|vice|barbell|dumbbell|bench|tool\s*set|kit/i.test(text);
        const lightweightHint = /sticker|label|needle|pin|clip|zip\s*tie|cable\s*tie|screw|bolt|nail|washer|paper|envelope|card/i.test(text);
        const estimatedTotalWeightGrams = heavyHint ? 450 : (lightweightHint ? 45 : null);
        const estimatedUnitWeightGrams = (estimatedTotalWeightGrams != null && quantity && quantity > 0)
            ? (estimatedTotalWeightGrams / quantity)
            : null;
        const maxG = config.filters.maxShippableWeightGrams;
        const recommendedResalePackQuantity = estimatedUnitWeightGrams != null
            ? Math.max(1, Math.floor(maxG / Math.max(estimatedUnitWeightGrams, 0.001)))
            : null;
        const estimatedResalePackWeightGrams = (estimatedUnitWeightGrams != null && recommendedResalePackQuantity != null)
            ? (estimatedUnitWeightGrams * recommendedResalePackQuantity)
            : estimatedTotalWeightGrams;
        const isResalePackShippableUnder100g = estimatedResalePackWeightGrams == null ? null : estimatedResalePackWeightGrams <= maxG;

        const signals = [];
        if (/multi-?pack|pack of/.test(text)) signals.push('multi-pack');
        if (/bulk|wholesale/.test(text)) signals.push('wholesale packaging');
        if (/industrial|commercial/.test(text)) signals.push('commercial use');
        if (/liquidation|joblot|pallet/.test(text)) signals.push('liquidation lot');
        if (isResalePackShippableUnder100g === true) signals.push('resale pack under-100g shippable');
        if (isResalePackShippableUnder100g === false) signals.push('resale pack over-100g estimated');

        return JSON.stringify({
            is_bulk: isBulk,
            is_resellable: isBulk && (internal === 'hardware' || internal === 'tools' || internal === 'office_supplies'),
            confidence: 0.55,
            category_prediction: this.toDisplayCategory(internal),
            summary: `Heuristic classification: ${internal}${isBulk ? ' (bulk)' : ''}`,
            signals,
            quantity,
            estimated_total_weight_grams: estimatedTotalWeightGrams,
            estimated_unit_weight_grams: estimatedUnitWeightGrams,
            recommended_resale_pack_quantity: recommendedResalePackQuantity,
            estimated_resale_pack_weight_grams: estimatedResalePackWeightGrams,
            is_resale_pack_shippable_under_100g: isResalePackShippableUnder100g,
            estimated_weight_grams: estimatedResalePackWeightGrams,
            is_shippable_under_100g: isResalePackShippableUnder100g,
            resale_suitability: isBulk ? (internal === 'hardware' || internal === 'tools' ? 'high' : 'medium') : 'low',
        });
    }

    getFallbackClassification(product) {
        return {
            is_bulk: false,
            is_resellable: false,
            confidence: 0.3,
            category_prediction: 'Misc',
            summary: 'Fallback (AI unavailable)',
            signals: [],
            quantity: null,
            estimated_total_weight_grams: null,
            estimated_unit_weight_grams: null,
            recommended_resale_pack_quantity: null,
            estimated_resale_pack_weight_grams: null,
            is_resale_pack_shippable_under_100g: null,
            estimated_weight_grams: null,
            is_shippable_under_100g: null,
            category: 'misc',
            resale_suitability: 'low',
            notes: 'Fallback classification',
            ai_provider: 'fallback',
        };
    }

    delay(ms) { return new Promise(r => setTimeout(r, ms)); }

    async shutdown() {
        this.isInitialized = false;
        this.imageCache.clear();
        console.log('[AI] Shutdown complete');
    }
}

module.exports = new AIClassifier();
