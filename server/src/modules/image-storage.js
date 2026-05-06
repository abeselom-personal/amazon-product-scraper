const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const config = require('../config/config');

class ImageStorage {
    constructor() {
        this.storageDir = path.resolve(process.cwd(), config.imageStorage.storagePath);
    }

    ensureStorageDir() {
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    getBaseUrl(baseUrl) {
        const candidate = (baseUrl || config.imageStorage.publicBaseUrl || '').trim();
        return candidate.replace(/\/+$/, '');
    }

    makePublicImageUrl(filename, baseUrl = '') {
        const prefix = this.getBaseUrl(baseUrl);
        return `${prefix}/files/images/${encodeURIComponent(filename)}`;
    }

    makeDownloadImageUrl(filename, baseUrl = '') {
        const prefix = this.getBaseUrl(baseUrl);
        return `${prefix}/files/images/${encodeURIComponent(filename)}/download`;
    }

    sanitizeToken(value, fallback = 'product') {
        const token = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return token || fallback;
    }

    inferExtension(url, contentType = '') {
        const ct = String(contentType || '').toLowerCase();
        if (ct.includes('png')) return '.png';
        if (ct.includes('webp')) return '.webp';
        if (ct.includes('gif')) return '.gif';
        if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';

        try {
            const pathname = new URL(url).pathname || '';
            const ext = path.extname(pathname).toLowerCase();
            if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
                return ext === '.jpeg' ? '.jpg' : ext;
            }
        } catch (_) {
            // no-op
        }

        return '.jpg';
    }

    downloadBuffer(url, timeoutMs = 12000, redirectsLeft = 3) {
        return new Promise((resolve, reject) => {
            let parsed;
            try {
                parsed = new URL(url);
            } catch (error) {
                reject(error);
                return;
            }

            const lib = parsed.protocol === 'http:' ? http : https;
            const req = lib.get(
                parsed,
                {
                    timeout: timeoutMs,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; AmazonProductDiscovery/2.0)',
                    },
                },
                (res) => {
                    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
                        res.resume();
                        const nextUrl = new URL(res.headers.location, parsed).toString();
                        this.downloadBuffer(nextUrl, timeoutMs, redirectsLeft - 1).then(resolve).catch(reject);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }

                    const chunks = [];
                    let total = 0;
                    const maxBytes = config.imageStorage.maxDownloadBytes;

                    res.on('data', (chunk) => {
                        chunks.push(chunk);
                        total += chunk.length;
                        if (total > maxBytes) {
                            req.destroy(new Error('Image exceeds max size limit'));
                        }
                    });
                    res.on('end', () => {
                        resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' });
                    });
                    res.on('error', reject);
                }
            );

            req.on('timeout', () => req.destroy(new Error('Image download timeout')));
            req.on('error', reject);
        });
    }

    async ensureImageStored(imageUrl, product = {}) {
        if (!imageUrl) return null;

        this.ensureStorageDir();

        const imageHash = crypto.createHash('sha1').update(imageUrl).digest('hex').slice(0, 16);
        const titleToken = this.sanitizeToken(product.asin || product.id || product.title, 'product');

        let finalFilename = `${titleToken}-${imageHash}.jpg`;
        let finalPath = path.join(this.storageDir, finalFilename);
        if (fs.existsSync(finalPath)) {
            return { filename: finalFilename, filePath: finalPath };
        }

        const { buffer, contentType } = await this.downloadBuffer(imageUrl);
        const ext = this.inferExtension(imageUrl, contentType);
        finalFilename = `${titleToken}-${imageHash}${ext}`;
        finalPath = path.join(this.storageDir, finalFilename);

        if (!fs.existsSync(finalPath)) {
            const tmpPath = `${finalPath}.tmp-${Date.now()}`;
            await fsp.writeFile(tmpPath, buffer);
            await fsp.rename(tmpPath, finalPath);
        }

        return { filename: finalFilename, filePath: finalPath };
    }

    async attachLocalImageLinks(product, options = {}) {
        const images = Array.isArray(product.images) && product.images.length
            ? product.images
            : (product.image_url ? [product.image_url] : []);

        if (!images.length) return product;

        const enriched = { ...product };
        const localImages = [];

        for (const imageUrl of images) {
            try {
                const stored = await this.ensureImageStored(imageUrl, product);
                if (!stored) continue;
                localImages.push({
                    source_url: imageUrl,
                    local_url: this.makePublicImageUrl(stored.filename, options.baseUrl),
                    local_download_url: this.makeDownloadImageUrl(stored.filename, options.baseUrl),
                });
            } catch (error) {
                console.warn(`[IMAGE] Failed to store image ${imageUrl}: ${error.message}`);
            }
        }

        if (!localImages.length) return enriched;

        enriched.local_images = localImages;
        enriched.local_image_url = localImages[0].local_url;
        enriched.local_image_download_url = localImages[0].local_download_url;

        return enriched;
    }

    async attachLocalImageLinksBatch(products, options = {}) {
        const result = [];
        for (const product of products) {
            result.push(await this.attachLocalImageLinks(product, options));
        }
        return result;
    }
}

module.exports = new ImageStorage();
