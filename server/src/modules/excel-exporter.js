const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const imageStorage = require('./image-storage');

function safeParseJSON(s, fallback) {
    if (s == null) return fallback;
    if (typeof s === 'object') return s;
    try { return JSON.parse(s); } catch (e) { return fallback; }
}

function asHttpUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return '';
}

function formatQuantityDisplay(product) {
    const qty = product.quantity_estimate != null && !isNaN(product.quantity_estimate)
        ? Math.max(0, Number(product.quantity_estimate))
        : null;

    if (product.is_bulk && (!qty || qty <= 1)) return 'Multipack';
    if (qty && qty > 1) return `${Math.round(qty)} pcs`;
    return '1 pc';
}

function getImagesArray(product) {
    const imgs = Array.isArray(product.images)
        ? product.images
        : safeParseJSON(product.images, []);
    if (Array.isArray(imgs) && imgs.length) return imgs;
    return product.image_url ? [product.image_url] : [];
}

class ExcelExporter {
    
    async exportProducts(products, filename = null, options = {}) {
        const productsForExport = config.imageStorage.enabled
            ? await imageStorage.attachLocalImageLinksBatch(products, options)
            : products;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Top Products');

        worksheet.columns = [
            { header: 'Rank', key: 'rank', width: 8 },
            { header: 'Title', key: 'title', width: 60 },
            { header: 'ASIN', key: 'asin', width: 12 },
            { header: 'Price (£)', key: 'price', width: 12 },
            { header: 'Quantity / Pack', key: 'quantity', width: 16 },
            { header: 'Unit Price (£)', key: 'unit_price', width: 14 },
            { header: 'Category', key: 'category', width: 18 },
            { header: 'Source Category', key: 'source_category', width: 16 },
            { header: 'Is Bulk', key: 'is_bulk', width: 10 },
            { header: 'Rating', key: 'rating', width: 10 },
            { header: 'Reviews', key: 'reviews', width: 10 },
            { header: 'Prime', key: 'prime', width: 8 },
            { header: 'Final Score', key: 'final_score', width: 12 },
            { header: 'Bulk Score', key: 'bulk_score', width: 12 },
            { header: 'Demand Score', key: 'demand_score', width: 14 },
            { header: 'Trust Score', key: 'trust_score', width: 12 },
            { header: 'Margin Score', key: 'margin_score', width: 14 },
            { header: 'Shipping Score', key: 'shipping_score', width: 14 },
            { header: 'Resale Suitability', key: 'resale', width: 18 },
            { header: 'AI Confidence', key: 'ai_confidence', width: 14 },
            { header: 'Est. Total Weight (g)', key: 'ai_total_weight_g', width: 18 },
            { header: 'Est. Unit Weight (g)', key: 'ai_unit_weight_g', width: 18 },
            { header: 'Recommended Resale Qty', key: 'ai_resale_pack_qty', width: 20 },
            { header: 'Est. Resale Pack Weight (g)', key: 'ai_resale_pack_weight_g', width: 24 },
            { header: 'Resale Pack <=100g', key: 'ai_shippable_100g', width: 18 },
            { header: 'AI Summary', key: 'ai_summary', width: 50 },
            { header: 'Primary Image', key: 'primary_image', width: 60 },
            { header: 'Local Image Link', key: 'local_image_url', width: 60 },
            { header: 'Image Download Link', key: 'local_image_download_url', width: 60 },
            { header: 'Image Count', key: 'image_count', width: 12 },
            { header: 'All Image URLs', key: 'all_images', width: 100 },
            { header: 'URL', key: 'url', width: 80 },
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

        productsForExport.forEach((product, index) => {
            const images = getImagesArray(product);
            const primary = images[0] || '';
            const allImages = images.join('\n');
            const localImageUrl = asHttpUrl(product.local_image_url);
            const localDownloadUrl = asHttpUrl(product.local_image_download_url);
            const productUrl = asHttpUrl(product.url);

            const row = worksheet.addRow({
                rank: index + 1,
                title: product.title || '',
                asin: product.asin || 'N/A',
                price: product.price || 0,
                quantity: formatQuantityDisplay(product),
                unit_price: product.unit_price || 0,
                category: product.category || 'misc',
                source_category: product.source_category || '',
                is_bulk: product.is_bulk ? 'Yes' : 'No',
                rating: product.rating || 'N/A',
                reviews: product.review_count || 0,
                prime: product.prime_eligible ? 'Yes' : 'No',
                final_score: product.final_score || 0,
                bulk_score: product.bulk_score || 0,
                demand_score: product.demand_score || 0,
                trust_score: product.trust_score || 0,
                margin_score: product.unit_margin_score || 0,
                shipping_score: product.shipping_score || 0,
                resale: product.resale_suitability || 'medium',
                ai_confidence: product.ai_confidence_score || 0,
                ai_total_weight_g: product.ai_estimated_total_weight_grams != null ? Number(product.ai_estimated_total_weight_grams) : '',
                ai_unit_weight_g: product.ai_estimated_unit_weight_grams != null ? Number(product.ai_estimated_unit_weight_grams) : '',
                ai_resale_pack_qty: product.ai_recommended_resale_pack_quantity != null ? Number(product.ai_recommended_resale_pack_quantity) : '',
                ai_resale_pack_weight_g: product.ai_estimated_resale_pack_weight_grams != null ? Number(product.ai_estimated_resale_pack_weight_grams) : (product.ai_estimated_weight_grams != null ? Number(product.ai_estimated_weight_grams) : ''),
                ai_shippable_100g: (product.ai_is_resale_pack_shippable_under_100g ?? product.ai_is_shippable_under_100g) == null
                    ? 'Unknown'
                    : ((product.ai_is_resale_pack_shippable_under_100g ?? product.ai_is_shippable_under_100g) ? 'Yes' : 'No'),
                ai_summary: product.ai_summary || '',
                primary_image: primary,
                local_image_url: localImageUrl,
                local_image_download_url: localDownloadUrl,
                image_count: images.length,
                all_images: allImages,
                url: productUrl,
            });

            // Hyperlink the primary image cell so it's clickable in Excel
            if (primary) {
                const cell = row.getCell('primary_image');
                cell.value = { text: 'Open Source Image', hyperlink: primary };
                cell.font = { color: { argb: 'FF0066CC' }, underline: true };
            }

            if (localImageUrl) {
                const cell = row.getCell('local_image_url');
                cell.value = { text: 'Open Local Image', hyperlink: localImageUrl };
                cell.font = { color: { argb: 'FF0066CC' }, underline: true };
            }

            if (localDownloadUrl) {
                const cell = row.getCell('local_image_download_url');
                cell.value = { text: 'Download Image', hyperlink: localDownloadUrl };
                cell.font = { color: { argb: 'FF0066CC' }, underline: true };
            }

            if (productUrl) {
                const cell = row.getCell('url');
                cell.value = { text: productUrl, hyperlink: productUrl };
                cell.font = { color: { argb: 'FF0066CC' }, underline: true };
            }

            // Wrap the all-images cell so the multiple URLs render nicely
            row.getCell('all_images').alignment = { wrapText: true, vertical: 'top' };

            if (product.final_score >= 0.7) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD4EDDA' }
                };
            } else if (product.final_score >= 0.5) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFF3CD' }
                };
            }
        });

        const lastColLetter = worksheet.lastColumn?.letter || 'X';
        worksheet.autoFilter = { from: 'A1', to: `${lastColLetter}1` };

        const exportDir = config.export.outputPath;
        if (!fs.existsSync(exportDir)) {
            fs.mkdirSync(exportDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const exportFilename = filename || `amazon_products_${timestamp}.xlsx`;
        const filepath = path.join(exportDir, exportFilename);

        await workbook.xlsx.writeFile(filepath);

        console.log(`[EXPORT] Exported ${products.length} products to: ${filepath}`);

        return {
            filepath,
            filename: exportFilename,
            productCount: products.length
        };
    }

    async exportTopProducts(limit = null, options = {}) {
        const dataStorage = require('./data-storage');
        const topLimit = limit || config.export.topN;
        
        const products = await dataStorage.getTopProducts(topLimit);
        
        return await this.exportProducts(products, null, options);
    }

    async exportByCategory(category, limit = 100, options = {}) {
        const dataStorage = require('./data-storage');
        
        const products = await dataStorage.getProductsByCategory(category, limit);
        
        const filename = `amazon_${category}_${new Date().toISOString().substring(0, 10)}.xlsx`;
        
        return await this.exportProducts(products, filename, options);
    }

    async exportRunResults(runId) {
        const dataStorage = require('./data-storage');
        const priceWhere = dataStorage.buildPriceFilterWhere();
        
        const products = await require('../database/db').all(
            `SELECT * FROM products 
             WHERE source_run_id = ? AND final_score IS NOT NULL${priceWhere.sql}
             ORDER BY final_score DESC`,
            [runId, ...priceWhere.params]
        );

        const filename = `amazon_run_${runId.substring(0, 8)}.xlsx`;
        
        return await this.exportProducts(products, filename);
    }
}

module.exports = new ExcelExporter();
