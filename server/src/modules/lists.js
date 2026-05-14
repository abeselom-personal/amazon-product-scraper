/**
 * Lists Module
 * Manages product lists for human curation and manual review
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const excelExporter = require('./excel-exporter');
const imageStorage = require('./image-storage');
const config = require('../config/config');

function safeParseJSON(s, fallback) {
    if (s == null) return fallback;
    if (typeof s === 'object') return s;
    try { return JSON.parse(s); } catch (e) { return fallback; }
}

class ListsModule {
    
    /**
     * Create a new product list
     */
    async createList({ name, description = '' }) {
        if (!name || name.trim().length === 0) {
            throw new Error('List name is required');
        }
        
        const listId = uuidv4();
        const now = new Date().toISOString();
        
        await db.run(
            `INSERT INTO product_lists (id, name, description, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?)`,
            [listId, name.trim(), description.trim(), now, now]
        );
        
        console.log(`[LISTS] Created list: ${listId} - "${name}"`);
        
        return {
            id: listId,
            name: name.trim(),
            description: description.trim(),
            created_at: now,
            updated_at: now,
            item_count: 0
        };
    }
    
    /**
     * Get all lists with item counts
     */
    async getAllLists() {
        const lists = await db.all(`
            SELECT l.*, COUNT(li.product_id) as item_count 
            FROM product_lists l
            LEFT JOIN list_items li ON l.id = li.list_id
            GROUP BY l.id
            ORDER BY l.updated_at DESC
        `);
        
        return lists.map(l => ({
            ...l,
            item_count: l.item_count || 0
        }));
    }
    
    /**
     * Get a single list by ID with all products
     */
    async getListById(listId, options = {}) {
        const list = await db.get(
            `SELECT * FROM product_lists WHERE id = ?`,
            [listId]
        );
        
        if (!list) {
            throw new Error(`List not found: ${listId}`);
        }
        
        // Get all products in this list with full product details
        const products = await db.all(`
            SELECT p.*, li.added_at, li.notes as list_notes
            FROM list_items li
            JOIN products p ON li.product_id = p.id
            WHERE li.list_id = ?
            ORDER BY li.added_at DESC
        `, [listId]);
        
        // Hydrate products
        const hydratedProducts = products.map(p => this.hydrateProduct(p, options.baseUrl));
        
        return {
            ...list,
            products: hydratedProducts,
            item_count: products.length
        };
    }
    
    /**
     * Update list name/description
     */
    async updateList(listId, { name, description }) {
        const list = await db.get(
            `SELECT * FROM product_lists WHERE id = ?`,
            [listId]
        );
        
        if (!list) {
            throw new Error(`List not found: ${listId}`);
        }
        
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
            if (!name || name.trim().length === 0) {
                throw new Error('List name cannot be empty');
            }
            updates.push('name = ?');
            params.push(name.trim());
        }
        
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description.trim());
        }
        
        if (updates.length === 0) {
            throw new Error('No fields to update');
        }
        
        updates.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(listId);
        
        await db.run(
            `UPDATE product_lists SET ${updates.join(', ')} WHERE id = ?`,
            params
        );
        
        console.log(`[LISTS] Updated list: ${listId}`);
        
        return this.getListById(listId);
    }
    
    /**
     * Delete a list and all its items
     */
    async deleteList(listId) {
        const list = await db.get(
            `SELECT * FROM product_lists WHERE id = ?`,
            [listId]
        );
        
        if (!list) {
            throw new Error(`List not found: ${listId}`);
        }
        
        // Cascade delete will handle list_items due to FOREIGN KEY with ON DELETE CASCADE
        await db.run(`DELETE FROM product_lists WHERE id = ?`, [listId]);
        
        console.log(`[LISTS] Deleted list: ${listId} - "${list.name}"`);
        
        return { success: true, deletedId: listId };
    }
    
    /**
     * Add a product to a list
     */
    async addProductToList(listId, productId, notes = '') {
        // Verify list exists
        const list = await db.get(
            `SELECT * FROM product_lists WHERE id = ?`,
            [listId]
        );
        
        if (!list) {
            throw new Error(`List not found: ${listId}`);
        }
        
        // Verify product exists
        const product = await db.get(
            `SELECT id FROM products WHERE id = ?`,
            [productId]
        );
        
        if (!product) {
            throw new Error(`Product not found: ${productId}`);
        }
        
        try {
            await db.run(
                `INSERT INTO list_items (list_id, product_id, added_at, notes) 
                 VALUES (?, ?, ?, ?)`,
                [listId, productId, new Date().toISOString(), notes]
            );
            
            // Update list's updated_at timestamp
            await db.run(
                `UPDATE product_lists SET updated_at = ? WHERE id = ?`,
                [new Date().toISOString(), listId]
            );
            
            console.log(`[LISTS] Added product ${productId} to list ${listId}`);
            
            return { success: true, listId, productId };
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                throw new Error('Product already exists in this list');
            }
            throw err;
        }
    }
    
    /**
     * Remove a product from a list
     */
    async removeProductFromList(listId, productId) {
        const result = await db.run(
            `DELETE FROM list_items WHERE list_id = ? AND product_id = ?`,
            [listId, productId]
        );
        
        if (result.changes === 0) {
            throw new Error('Product not found in this list');
        }
        
        // Update list's updated_at timestamp
        await db.run(
            `UPDATE product_lists SET updated_at = ? WHERE id = ?`,
            [new Date().toISOString(), listId]
        );
        
        console.log(`[LISTS] Removed product ${productId} from list ${listId}`);
        
        return { success: true, listId, productId };
    }
    
    /**
     * Update notes for a product in a list
     */
    async updateProductNotes(listId, productId, notes) {
        const result = await db.run(
            `UPDATE list_items SET notes = ? WHERE list_id = ? AND product_id = ?`,
            [notes, listId, productId]
        );
        
        if (result.changes === 0) {
            throw new Error('Product not found in this list');
        }
        
        console.log(`[LISTS] Updated notes for product ${productId} in list ${listId}`);
        
        return { success: true, listId, productId, notes };
    }
    
    /**
     * Export a list to Excel
     */
    async exportList(listId, options = {}) {
        const list = await this.getListById(listId, options);
        
        if (!list.products || list.products.length === 0) {
            throw new Error('Cannot export empty list');
        }
        
        const filename = `list_${list.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().substring(0, 10)}.xlsx`;
        
        // Add list notes to products for export
        const productsWithNotes = list.products.map(p => ({
            ...p,
            list_notes: p.list_notes || ''
        }));
        
        const result = await excelExporter.exportProducts(productsWithNotes, filename, options);
        
        console.log(`[LISTS] Exported list ${listId} with ${list.products.length} products`);
        
        return result;
    }
    
    /**
     * Hydrate product from database row
     */
    hydrateProduct(row, baseUrl) {
        if (!row) return null;
        
        const p = { ...row };
        
        // Parse JSON fields
        p.images = safeParseJSON(p.images, []);
        p.ai_signals = safeParseJSON(p.ai_signals, []);
        
        // Add local image URLs if enabled
        if (config.imageStorage.enabled && baseUrl) {
            const localImages = safeParseJSON(p.local_images, []);
            if (localImages.length > 0) {
                p.local_image_url = `${baseUrl}${localImages[0].local_url}`;
                p.local_image_download_url = `${baseUrl}${localImages[0].local_download_url}`;
                p.local_images = localImages;
            }
        }
        
        return p;
    }
    
    /**
     * Check if a product is in a specific list
     */
    async isProductInList(listId, productId) {
        const item = await db.get(
            `SELECT 1 FROM list_items WHERE list_id = ? AND product_id = ?`,
            [listId, productId]
        );
        
        return !!item;
    }
    
    /**
     * Get all lists that contain a specific product
     */
    async getListsContainingProduct(productId) {
        const lists = await db.all(`
            SELECT l.id, l.name 
            FROM product_lists l
            JOIN list_items li ON l.id = li.list_id
            WHERE li.product_id = ?
            ORDER BY l.name
        `, [productId]);
        
        return lists;
    }
    
    /**
     * Bulk add products to a list
     */
    async bulkAddProductsToList(listId, productIds, notes = '') {
        const results = {
            added: 0,
            alreadyExists: 0,
            failed: 0,
            errors: []
        };
        
        for (const productId of productIds) {
            try {
                await this.addProductToList(listId, productId, notes);
                results.added++;
            } catch (err) {
                if (err.message && err.message.includes('already exists')) {
                    results.alreadyExists++;
                } else {
                    results.failed++;
                    results.errors.push({ productId, error: err.message });
                }
            }
        }
        
        console.log(`[LISTS] Bulk add to list ${listId}: ${results.added} added, ${results.alreadyExists} already existed, ${results.failed} failed`);
        
        return results;
    }
}

module.exports = new ListsModule();
