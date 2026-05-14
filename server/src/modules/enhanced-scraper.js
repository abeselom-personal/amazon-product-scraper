const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');
const config = require('../config/config');

class EnhancedScraper {
    constructor() {
        this.userAgentIndex = 0;
        this.requestCount = 0;
    }

    getNextUserAgent() {
        const userAgent = config.scraper.userAgents[this.userAgentIndex];
        this.userAgentIndex = (this.userAgentIndex + 1) % config.scraper.userAgents.length;
        return userAgent;
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async applyRateLimit() {
        this.requestCount++;
        if (this.requestCount > 1) {
            await this.delay(config.scraper.rateLimitDelayMs);
        }
    }

    parsePriceToFloat(priceString) {
        if (!priceString || typeof priceString !== 'string') {
            return null;
        }

        const lastDotIndex = priceString.lastIndexOf('.');
        const lastCommaIndex = priceString.lastIndexOf(',');

        let cleanedString;

        if (lastCommaIndex > lastDotIndex) {
            cleanedString = priceString.replace(/\./g, '').replace(',', '.');
        } else {
            cleanedString = priceString.replace(/,/g, '');
        }

        const finalString = cleanedString.replace(/[^\d.]/g, '');
        const price = parseFloat(finalString);

        return isNaN(price) ? null : price;
    }

    parseRatingToFloat(ratingString) {
        if (!ratingString || typeof ratingString !== 'string') {
            return null;
        }

        const standardizedString = ratingString.replace(',', '.');
        const match = standardizedString.match(/(\d+\.\d+)|(\d+)/);

        if (match && match[0]) {
            return parseFloat(match[0]);
        }

        return null;
    }

    parseReviewCount(reviewString) {
        if (!reviewString || typeof reviewString !== 'string') {
            return 0;
        }

        const cleaned = reviewString.replace(/[^\d]/g, '');
        const count = parseInt(cleaned, 10);
        return isNaN(count) ? 0 : count;
    }

    extractASIN(url) {
        if (!url) return null;
        
        const asinMatch = url.match(/\/dp\/([A-Z0-9]{10})/i) || 
                         url.match(/\/gp\/product\/([A-Z0-9]{10})/i) ||
                         url.match(/\/ASIN\/([A-Z0-9]{10})/i);
        
        return asinMatch ? asinMatch[1].toUpperCase() : null;
    }

    async autoScroll(page) {
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 400;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight - window.innerHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 150);
            });
        });
        await page.evaluate(() => window.scrollTo(0, 0));
    }

    async scrapePageWithRetry(url, retries = 0) {
        let browser;
        try {
            await this.applyRateLimit();

            browser = await puppeteer.launch({
                headless: 'new',
                executablePath: config.scraper.chromiumPath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ]
            });

            const page = await browser.newPage();
            await page.setViewport({ width: 1366, height: 900 });
            await page.setUserAgent(this.getNextUserAgent());

            await page.setRequestInterception(true);
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (['stylesheet', 'font', 'media'].includes(resourceType)) {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            console.log(`[SCRAPER] Navigating to: ${url}`);
            
            await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: config.scraper.timeout 
            });

            await page.waitForSelector('div[data-component-type="s-search-result"]', { 
                timeout: 15000 
            }).catch(() => {
                console.log('[SCRAPER] Timeout waiting for products - continuing anyway');
            });

            console.log('[SCRAPER] Auto-scrolling to trigger lazy-loaded content...');
            await this.autoScroll(page);
            await page.waitForTimeout ? await page.waitForTimeout(800) : await new Promise(r => setTimeout(r, 800));

            const html = await page.content();
            await browser.close();
            browser = null;

            return html;

        } catch (error) {
            if (browser) {
                try { await browser.close(); } catch (e) {}
            }
            console.error(`[SCRAPER] Error on attempt ${retries + 1}:`, error.message);

            if (retries < config.scraper.maxRetries) {
                const delayMs = config.scraper.retryDelayMs * Math.pow(2, retries);
                console.log(`[SCRAPER] Retrying in ${delayMs}ms...`);
                await this.delay(delayMs);
                return this.scrapePageWithRetry(url, retries + 1);
            }

            throw error;
        }
    }

    parseProducts(html, baseUrl, region) {
        const $ = cheerio.load(html);
        const productElements = $('div[data-component-type="s-search-result"]');
        const products = [];

        console.log(`[SCRAPER] Found ${productElements.length} product elements`);

        productElements.each((idx, el) => {
            const titleElement = $(el).find('div[data-cy="title-recipe"] a h2 span').first();
            const linkElement = $(el).find('div[data-cy="title-recipe"] a.a-link-normal').first();
            const ratingElement = $(el).find('i.a-icon-star-small .a-icon-alt, i.a-icon-star .a-icon-alt').first();
            const imageElement = $(el).find('div[data-cy="image-container"] img.s-image').first();
            const primeElement = $(el).find('i[aria-label*="Prime"], .a-icon-prime');

            let reviewCount = 0;
            const reviewAnchor = $(el).find('a[href*="#customerReviews"]').first();
            if (reviewAnchor.length) {
                const ariaLabel = reviewAnchor.attr('aria-label') || '';
                const innerText = reviewAnchor.find('span.a-size-base, span.s-underline-text').first().text().trim() ||
                                  reviewAnchor.text().trim();
                reviewCount = this.parseReviewCount(ariaLabel) || this.parseReviewCount(innerText);
            }
            if (!reviewCount) {
                const altReview = $(el).find('span.a-size-base.s-underline-text, span[data-component-type="s-client-side-analytics"] span').first();
                if (altReview.length) {
                    reviewCount = this.parseReviewCount(altReview.text().trim());
                }
            }
            if (!reviewCount) {
                const ratingsBlock = $(el).find('div[data-cy="reviews-block"]');
                ratingsBlock.find('span').each((i, s) => {
                    if (reviewCount) return;
                    const txt = $(s).text().trim();
                    if (/^[\d,\.]+$/.test(txt) && txt.length <= 8) {
                        const n = this.parseReviewCount(txt);
                        if (n >= 1) reviewCount = n;
                    }
                });
            }

            let price = null;
            let priceEl = $(el).find('div[data-cy="price-recipe"] .a-price .a-offscreen');
            if (priceEl.length) {
                price = this.parsePriceToFloat(priceEl.text().trim());
            }

            if (!price) {
                priceEl = $(el).find('div[data-cy="secondary-offer-recipe"] .a-color-base');
                if (priceEl.length) {
                    price = this.parsePriceToFloat(priceEl.text().trim());
                }
            }

            if (!price) {
                priceEl = $(el).find('.a-price .a-offscreen');
                if (priceEl.length) {
                    price = this.parsePriceToFloat(priceEl.text().trim());
                }
            }

            if (!price) {
                const whole = $(el).find('.a-price-whole').text().trim();
                const fraction = $(el).find('.a-price-fraction').text().trim();
                if (whole && fraction) {
                    price = parseFloat(whole + '.' + fraction);
                }
            }

            const title = titleElement.text().trim() || null;
            const productUrl = linkElement.attr('href') ? `${baseUrl}${linkElement.attr('href')}` : null;
            const rating = ratingElement.text() ? this.parseRatingToFloat(ratingElement.text().trim()) : null;

            const imageSet = new Set();
            const primary = imageElement.attr('src') || imageElement.attr('data-src');
            if (primary) imageSet.add(this.upgradeImageUrl(primary));
            const srcset = imageElement.attr('srcset') || imageElement.attr('data-srcset');
            if (srcset) {
                srcset.split(',').forEach(part => {
                    const u = part.trim().split(/\s+/)[0];
                    if (u) imageSet.add(this.upgradeImageUrl(u));
                });
            }
            // Extra <img> elements anywhere in the card
            $(el).find('img').each((_, im) => {
                const s = $(im).attr('src') || $(im).attr('data-src');
                if (s && /\.(jpg|jpeg|png|webp|gif)/i.test(s)) imageSet.add(this.upgradeImageUrl(s));
            });

            const images = Array.from(imageSet).slice(0, config.productDetail.maxImagesPerProduct);
            const imageUrl = images[0] || null;
            const primeEligible = primeElement.length > 0;
            const asin = productUrl ? this.extractASIN(productUrl) : null;

            // Validate URL - skip if missing, empty, or invalid (e.g., just "#")
            const isValidUrl = productUrl && 
                               productUrl !== '#' && 
                               !productUrl.endsWith('#') &&
                               productUrl.includes('/dp/') &&
                               asin;

            if (title && isValidUrl) {
                products.push({
                    title,
                    price,
                    rating,
                    review_count: reviewCount,
                    url: productUrl,
                    image_url: imageUrl,
                    images,
                    region,
                    prime_eligible: primeEligible,
                    asin
                });
            }
        });

        return products;
    }

    upgradeImageUrl(url) {
        if (!url) return url;
        // Amazon serves images at multiple resolutions; upgrade to a larger variant when possible
        return url.replace(/\._(?:AC_)?(?:US|UY|UL|SR|SX|SS|SY|SL|CR|FMjpg|FMpng|QL\d+|SS\d+)?[^.]+_\.([a-z]+)$/i, '._SL500_.$1');
    }

    parsePagination(html, currentPage) {
        const $ = cheerio.load(html);
        const paginationContainer = $('.s-pagination-strip');
        
        let totalPages = 1;

        if (paginationContainer.length) {
            const lastPageElement = paginationContainer.find(
                '.s-pagination-item.s-pagination-disabled:not(.s-pagination-previous):not(.s-pagination-ellipsis)'
            ).first();

            if (lastPageElement.length) {
                const pageText = lastPageElement.text().trim();
                if (pageText !== '...') {
                    const parsed = parseInt(pageText, 10);
                    if (!isNaN(parsed)) totalPages = parsed;
                }
            }

            const nextButtonDisabled = paginationContainer.find(
                '.s-pagination-item.s-pagination-next.s-pagination-disabled'
            ).length > 0;

            if (nextButtonDisabled) totalPages = currentPage;
        }

        return totalPages;
    }

    buildSearchUrl(baseUrl, { keyword = '', browseNode = null, page = 1 } = {}) {
        const params = new URLSearchParams();
        if (keyword) params.set('k', keyword);
        if (browseNode) params.set('rh', browseNode);
        params.set('page', String(page));
        return `${baseUrl}/s?${params.toString()}`;
    }

    async scrapeUrlPaginated(buildUrl, region, maxPages = null, label = '') {
        const baseUrl = config.amazon.domains[region];
        if (!baseUrl) throw new Error(`Invalid region: ${region}`);

        // Use config default if maxPages not provided
        if (maxPages === null) {
            maxPages = config.scraper.defaultMaxPages;
        }
        // Cap at hard max
        if (maxPages > config.scraper.hardMaxPages) {
            console.log(`[SCRAPER] Caping maxPages from ${maxPages} to ${config.scraper.hardMaxPages}`);
            maxPages = config.scraper.hardMaxPages;
        }

        const allProducts = [];
        let currentPage = 1;
        let totalPages = 1;

        do {
            const url = buildUrl(currentPage);
            try {
                const html = await this.scrapePageWithRetry(url);
                const products = this.parseProducts(html, baseUrl, region);
                console.log(`[SCRAPER] ${label} page ${currentPage}: ${products.length} products`);
                allProducts.push(...products);

                if (currentPage === 1) {
                    totalPages = this.parsePagination(html, currentPage);
                    if (maxPages && totalPages > maxPages) totalPages = maxPages;
                    console.log(`[SCRAPER] ${label} total pages: ${totalPages}`);
                }
                if (products.length === 0) break;
                currentPage++;
            } catch (err) {
                console.error(`[SCRAPER] Failed page ${currentPage}:`, err.message);
                break;
            }
        } while (currentPage <= totalPages);

        return { products: allProducts, totalPages: currentPage - 1 };
    }

    async scrapeCategory(categoryName, region = 'UK', maxPages = null) {
        const cfg = config.categories.sources[categoryName];
        if (!cfg) {
            throw new Error(`Unknown category: ${categoryName}. Configure it in config.categories.sources.`);
        }
        const baseUrl = config.amazon.domains[region];
        if (!baseUrl) throw new Error(`Invalid region: ${region}`);

        const all = [];
        const keywords = cfg.keywords && cfg.keywords.length ? cfg.keywords : [''];
        const browseNode = region === 'UK' ? cfg.browseNodeUK : null;

        for (const kw of keywords) {
            const buildUrl = (page) => this.buildSearchUrl(baseUrl, { keyword: kw, browseNode, page });
            const { products } = await this.scrapeUrlPaginated(buildUrl, region, maxPages, `[cat:${categoryName}|${kw || 'browse'}]`);
            products.forEach(p => { p.source_category = categoryName; });
            all.push(...products);
        }

        console.log(`[SCRAPER] Category "${categoryName}" complete. Total: ${all.length}`);
        return { products: all, region, category: categoryName };
    }

    async fetchProductDetailImages(productUrl) {
        // Optional: visit the PDP and grab the gallery image list
        try {
            const html = await this.scrapePageWithRetry(productUrl);
            const $ = cheerio.load(html);
            const imageSet = new Set();
            $('#altImages img, #imageBlock img, #main-image-container img, .imgTagWrapper img').each((_, im) => {
                const src = $(im).attr('src') || $(im).attr('data-src') || $(im).attr('data-old-hires');
                if (src && /\.(jpg|jpeg|png|webp)/i.test(src)) imageSet.add(this.upgradeImageUrl(src));
            });
            // Try the JSON colorImages payload
            const html2 = html;
            const m = html2.match(/colorImages['"]?\s*:\s*\{[^{}]*?large['"]?\s*:\s*['"]([^'"]+)['"]/);
            if (m) imageSet.add(this.upgradeImageUrl(m[1]));
            return Array.from(imageSet).slice(0, config.productDetail.maxImagesPerProduct);
        } catch (err) {
            console.warn('[SCRAPER] PDP image fetch failed:', err.message);
            return [];
        }
    }

    async scrapeKeyword(keyword, region = 'UK', maxPages = null) {
        const baseUrl = config.amazon.domains[region];
        if (!baseUrl) {
            throw new Error(`Invalid region: ${region}`);
        }

        // Use config default if maxPages not provided
        if (maxPages === null) {
            maxPages = config.scraper.defaultMaxPages;
        }
        // Cap at hard max
        if (maxPages > config.scraper.hardMaxPages) {
            console.log(`[SCRAPER] Caping maxPages from ${maxPages} to ${config.scraper.hardMaxPages}`);
            maxPages = config.scraper.hardMaxPages;
        }

        const allProducts = [];
        let currentPage = 1;
        let totalPages = 1;

        console.log(`[SCRAPER] Starting scrape for keyword: "${keyword}" in region: ${region} (max pages: ${maxPages})`);

        do {
            const encodedKeyword = encodeURIComponent(keyword);
            const url = `${baseUrl}/s?k=${encodedKeyword}&page=${currentPage}`;

            try {
                const html = await this.scrapePageWithRetry(url);
                const products = this.parseProducts(html, baseUrl, region);
                
                console.log(`[SCRAPER] Page ${currentPage}: Found ${products.length} products`);
                
                allProducts.push(...products);

                if (currentPage === 1) {
                    totalPages = this.parsePagination(html, currentPage);
                    console.log(`[SCRAPER] Total pages detected: ${totalPages}`);
                    
                    if (maxPages && totalPages > maxPages) {
                        totalPages = maxPages;
                        console.log(`[SCRAPER] Limiting to ${maxPages} pages`);
                    }
                }

                if (products.length === 0) {
                    console.log('[SCRAPER] No products found, stopping pagination');
                    break;
                }

                currentPage++;

            } catch (error) {
                console.error(`[SCRAPER] Failed to scrape page ${currentPage}:`, error.message);
                break;
            }

        } while (currentPage <= totalPages);

        console.log(`[SCRAPER] Scraping complete. Total products: ${allProducts.length}`);
        
        return {
            products: allProducts,
            totalPages: currentPage - 1,
            keyword,
            region
        };
    }
}

module.exports = new EnhancedScraper();
