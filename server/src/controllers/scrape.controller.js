const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

class ScrapeController {

    constructor() {
        this.scrapeData = this.scrapeData.bind(this);
    }

    // Parses a price string (e.g., "$1,234.56" or "R$ 1.234,56") and converts it to a float.
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

    // Extracts the numeric value from a rating string (e.g., "4.5 out of 5 stars")
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

    // Main scraping method using Puppeteer + Cheerio
    async scrapeData(req, res) {
        const startTime = Date.now();

        const logStep = (step, data = null) => {
            const time = Date.now() - startTime;
            console.log(`[SCRAPER][+${time}ms] ${step}`);
            if (data !== null) {
                console.log(`[SCRAPER][DATA] ${JSON.stringify(data)}`);
            }
        };

        try {
            logStep("Request received", { query: req.query });

            const keyword = req.query.keyword;
            const region = req.query.region || "UK";
            const page = req.query.page || 1;

            logStep("Parsed input params", { keyword, region, page });

            if (!keyword) {
                logStep("Missing keyword, aborting request");
                return res.status(400).json({ error: "Keyword is required" });
            }

            const amazonDomains = {
                UK: "https://www.amazon.co.uk",
                US: "https://www.amazon.com",
            };

            const baseUrl = amazonDomains[region];
            if (!baseUrl) {
                logStep("Invalid region provided", { region });
                return res.status(400).json({ error: "Invalid region" });
            }

            const encodedKeyword = encodeURIComponent(keyword);
            const url = `${baseUrl}/s?k=${encodedKeyword}&page=${page}`;

            logStep("Generated Amazon URL", { url });

            // Launch Puppeteer
            const browser = await puppeteer.launch({
                headless: true,
                executablePath: '/usr/bin/chromium',  // or '/usr/bin/chromium-browser'
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const pageObj = await browser.newPage();
            await pageObj.setViewport({ width: 1280, height: 800 });
            await pageObj.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            logStep("Navigating to Amazon URL");

            // Wait until network is idle (most resources loaded)
            await pageObj.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

            // Optional: wait for product containers to appear
            await pageObj.waitForSelector('div[data-component-type="s-search-result"]', { timeout: 10000 })
                .catch(() => logStep("Timeout waiting for product elements – continuing anyway"));

            const html = await pageObj.content();
            await browser.close();

            logStep("Page content retrieved", { contentLength: html.length });

            // Parse with Cheerio (avoids CSS parsing errors)
            const $ = cheerio.load(html);

            const productElements = $('div[data-component-type="s-search-result"]');
            logStep("Product elements found", { count: productElements.length });

            const products = [];

            productElements.each((idx, el) => {
                const titleElement = $(el).find('div[data-cy="title-recipe"] a h2 span');
                const linkElement = $(el).find('div[data-cy="title-recipe"] .a-link-normal');
                const ratingElement = $(el).find('div[data-cy="reviews-block"] .a-icon-alt');
                const imageElement = $(el).find('div[data-cy="image-container"] .s-image');

                // ---- PRICE EXTRACTION with multiple fallbacks ----
                let price = null;
                let priceSource = "none";

                // Try primary
                let priceEl = $(el).find('div[data-cy="price-recipe"] .a-price .a-offscreen');
                if (priceEl.length) {
                    price = this.parsePriceToFloat(priceEl.text().trim());
                    priceSource = "price-recipe .a-offscreen";
                }
                // Try secondary
                if (!price) {
                    priceEl = $(el).find('div[data-cy="secondary-offer-recipe"] .a-color-base');
                    if (priceEl.length) {
                        price = this.parsePriceToFloat(priceEl.text().trim());
                        priceSource = "secondary-offer-recipe .a-color-base";
                    }
                }
                // Try any .a-price .a-offscreen
                if (!price) {
                    priceEl = $(el).find('.a-price .a-offscreen');
                    if (priceEl.length) {
                        price = this.parsePriceToFloat(priceEl.text().trim());
                        priceSource = "generic .a-price .a-offscreen";
                    }
                }
                // Try building from whole + fraction
                if (!price) {
                    const whole = $(el).find('.a-price-whole').text().trim();
                    const fraction = $(el).find('.a-price-fraction').text().trim();
                    if (whole && fraction) {
                        price = parseFloat(whole + '.' + fraction);
                        priceSource = "price-parts";
                    }
                }

                const title = titleElement.text().trim() || null;
                const productUrl = linkElement.attr('href') ? `${baseUrl}${linkElement.attr('href')}` : null;
                const ratingStars = ratingElement.text() ? this.parseRatingToFloat(ratingElement.text().trim()) : null;
                const imageUrl = imageElement.attr('src') || null;

                const productObj = { title, price, ratingStars, imageUrl, productUrl, region, priceSource };

                if (idx < 3) logStep(`Sample product ${idx}`, productObj);

                // Keep product even if price is null (only require title)
                if (title) {
                    products.push(productObj);
                    if (!price) logStep(`Product ${idx} kept without price`, { title: title.substring(0, 40) });
                } else {
                    logStep(`Product ${idx} filtered out (no title)`);
                }
            });
            logStep("Products after filtering", {
                total: productElements.length,
                valid: products.length
            });

            // Pagination extraction (Cheerio version)
            const paginationContainer = $('.s-pagination-strip');
            let totalPages = 1;
            let currentPage = parseInt(page, 10);

            if (paginationContainer.length) {
                logStep("Pagination container found");

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

                logStep("Pagination parsed", { currentPage, totalPages });
            } else {
                logStep("No pagination container found");
            }

            const duration = Date.now() - startTime;
            logStep("Scraping completed successfully", {
                productCount: products.length,
                durationMs: duration
            });

            return res.json({ products, currentPage, totalPages });

        } catch (error) {
            logStep("ERROR occurred during scraping", {
                message: error.message,
                stack: error.stack
            });

            return res.status(500).json({
                error: "An error occurred while scraping data.",
                details: error.message
            });
        }
    }
}

module.exports = new ScrapeController();
