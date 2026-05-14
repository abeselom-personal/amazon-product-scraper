/**
 * Lists Controller
 * API endpoints for managing product lists
 */

const lists = require('../modules/lists');
const config = require('../config/config');

class ListsController {
    
    getRequestBaseUrl(req) {
        const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        const proto = forwardedProto || req.protocol || 'http';
        const host = req.get('host');
        return host ? `${proto}://${host}` : '';
    }
    
    /**
     * POST /api/lists
     * Create a new list
     */
    async createList(req, res) {
        try {
            const { name, description } = req.body;
            
            if (!name || name.trim().length === 0) {
                return res.status(400).json({ error: 'List name is required' });
            }
            
            const list = await lists.createList({ name, description });
            
            return res.status(201).json({
                success: true,
                list
            });
        } catch (error) {
            console.error('[API] Error in createList:', error);
            return res.status(500).json({
                error: 'Failed to create list',
                details: error.message
            });
        }
    }
    
    /**
     * GET /api/lists
     * Get all lists with item counts
     */
    async getAllLists(req, res) {
        try {
            const listsData = await lists.getAllLists();
            
            return res.json({
                success: true,
                lists: listsData,
                count: listsData.length
            });
        } catch (error) {
            console.error('[API] Error in getAllLists:', error);
            return res.status(500).json({
                error: 'Failed to retrieve lists',
                details: error.message
            });
        }
    }
    
    /**
     * GET /api/lists/:id
     * Get a single list with all products
     */
    async getListById(req, res) {
        try {
            const { id } = req.params;
            const baseUrl = this.getRequestBaseUrl(req);
            
            const list = await lists.getListById(id, { baseUrl });
            
            return res.json({
                success: true,
                list
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'List not found',
                    details: error.message
                });
            }
            console.error('[API] Error in getListById:', error);
            return res.status(500).json({
                error: 'Failed to retrieve list',
                details: error.message
            });
        }
    }
    
    /**
     * PUT /api/lists/:id
     * Update list name/description
     */
    async updateList(req, res) {
        try {
            const { id } = req.params;
            const { name, description } = req.body;
            
            const list = await lists.updateList(id, { name, description });
            
            return res.json({
                success: true,
                list
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'List not found',
                    details: error.message
                });
            }
            console.error('[API] Error in updateList:', error);
            return res.status(500).json({
                error: 'Failed to update list',
                details: error.message
            });
        }
    }
    
    /**
     * DELETE /api/lists/:id
     * Delete a list
     */
    async deleteList(req, res) {
        try {
            const { id } = req.params;
            
            const result = await lists.deleteList(id);
            
            return res.json({
                success: true,
                result
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'List not found',
                    details: error.message
                });
            }
            console.error('[API] Error in deleteList:', error);
            return res.status(500).json({
                error: 'Failed to delete list',
                details: error.message
            });
        }
    }
    
    /**
     * POST /api/lists/:id/products
     * Add a product to a list
     */
    async addProductToList(req, res) {
        try {
            const { id } = req.params;
            const { productId, notes } = req.body;
            
            if (!productId) {
                return res.status(400).json({
                    error: 'productId is required'
                });
            }
            
            const result = await lists.addProductToList(id, productId, notes);
            
            return res.status(201).json({
                success: true,
                result
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'List or product not found',
                    details: error.message
                });
            }
            if (error.message && error.message.includes('already exists')) {
                return res.status(409).json({
                    error: 'Product already in list',
                    details: error.message
                });
            }
            console.error('[API] Error in addProductToList:', error);
            return res.status(500).json({
                error: 'Failed to add product to list',
                details: error.message
            });
        }
    }
    
    /**
     * POST /api/lists/:id/products/bulk
     * Bulk add products to a list
     */
    async bulkAddProductsToList(req, res) {
        try {
            const { id } = req.params;
            const { productIds, notes } = req.body;
            
            if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
                return res.status(400).json({
                    error: 'productIds array is required'
                });
            }
            
            const result = await lists.bulkAddProductsToList(id, productIds, notes);
            
            return res.status(201).json({
                success: true,
                result
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'List not found',
                    details: error.message
                });
            }
            console.error('[API] Error in bulkAddProductsToList:', error);
            return res.status(500).json({
                error: 'Failed to bulk add products to list',
                details: error.message
            });
        }
    }
    
    /**
     * DELETE /api/lists/:id/products/:productId
     * Remove a product from a list
     */
    async removeProductFromList(req, res) {
        try {
            const { id, productId } = req.params;
            
            const result = await lists.removeProductFromList(id, productId);
            
            return res.json({
                success: true,
                result
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'Product not found in list',
                    details: error.message
                });
            }
            console.error('[API] Error in removeProductFromList:', error);
            return res.status(500).json({
                error: 'Failed to remove product from list',
                details: error.message
            });
        }
    }
    
    /**
     * PUT /api/lists/:id/products/:productId/notes
     * Update notes for a product in a list
     */
    async updateProductNotes(req, res) {
        try {
            const { id, productId } = req.params;
            const { notes } = req.body;
            
            const result = await lists.updateProductNotes(id, productId, notes);
            
            return res.json({
                success: true,
                result
            });
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'Product not found in list',
                    details: error.message
                });
            }
            console.error('[API] Error in updateProductNotes:', error);
            return res.status(500).json({
                error: 'Failed to update product notes',
                details: error.message
            });
        }
    }
    
    /**
     * GET /api/lists/:id/export
     * Export a list to Excel
     */
    async exportList(req, res) {
        try {
            const { id } = req.params;
            const baseUrl = this.getRequestBaseUrl(req);
            
            const result = await lists.exportList(id, { baseUrl });
            
            return res.download(result.filepath, result.filename);
        } catch (error) {
            if (error.message && error.message.includes('not found')) {
                return res.status(404).json({
                    error: 'List not found',
                    details: error.message
                });
            }
            if (error.message && error.message.includes('empty')) {
                return res.status(400).json({
                    error: 'Cannot export empty list',
                    details: error.message
                });
            }
            console.error('[API] Error in exportList:', error);
            return res.status(500).json({
                error: 'Failed to export list',
                details: error.message
            });
        }
    }
    
    /**
     * GET /api/lists/check/:productId
     * Get all lists that contain a specific product
     */
    async getListsContainingProduct(req, res) {
        try {
            const { productId } = req.params;
            
            const lists = await lists.getListsContainingProduct(productId);
            
            return res.json({
                success: true,
                lists,
                count: lists.length
            });
        } catch (error) {
            console.error('[API] Error in getListsContainingProduct:', error);
            return res.status(500).json({
                error: 'Failed to check product lists',
                details: error.message
            });
        }
    }
}

module.exports = new ListsController();
