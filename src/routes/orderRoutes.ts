import express from 'express';
import {
    clearDemoOrders,
    createOrder,
    deleteOrderByID,
    getNearbyOrders,
    getOrder,
    getOrderByID,
    quickOrder,
    randomOrder,
    updateOrderByID,
} from '../controllers/orderController';

export const router = express.Router();

// path คงที่ต้องมาก่อน /:id
router.get('/', getOrder);
router.get('/nearby', getNearbyOrders);
router.post('/', createOrder);
router.post('/quick', quickOrder);
router.post('/random', randomOrder);
router.delete('/demo', clearDemoOrders);
router.get('/:id', getOrderByID);
router.put('/:id', updateOrderByID);
router.delete('/:id', deleteOrderByID);
