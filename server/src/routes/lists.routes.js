/**
 * Lists Routes
 * API routes for product list management
 */

const express = require('express');
const listsController = require('../controllers/lists.controller');

function setListsRoutes(app) {
    const router = express.Router();
    
    // List CRUD
    router.post('/', listsController.createList.bind(listsController));
    router.get('/', listsController.getAllLists.bind(listsController));
    router.get('/:id', listsController.getListById.bind(listsController));
    router.put('/:id', listsController.updateList.bind(listsController));
    router.delete('/:id', listsController.deleteList.bind(listsController));
    
    // List items
    router.post('/:id/products', listsController.addProductToList.bind(listsController));
    router.post('/:id/products/bulk', listsController.bulkAddProductsToList.bind(listsController));
    router.delete('/:id/products/:productId', listsController.removeProductFromList.bind(listsController));
    router.put('/:id/products/:productId/notes', listsController.updateProductNotes.bind(listsController));
    
    // Export
    router.get('/:id/export', listsController.exportList.bind(listsController));
    
    // Check which lists contain a product
    router.get('/check/:productId', listsController.getListsContainingProduct.bind(listsController));
    
    app.use('/api/lists', router);
}

module.exports = setListsRoutes;
