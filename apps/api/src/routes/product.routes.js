import { Router } from 'express';

import {
  createProduct,
  getProduct,
  getProductCompetitors,
  getProductHistory,
  listProducts,
  updateProduct,
} from '../controllers/product.controller.js';
import {
  bulkUpsertProductSales,
  getProductSales,
} from '../controllers/sales.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', listProducts);
router.post('/', createProduct);
router.post('/:id/sales/bulk', bulkUpsertProductSales);
router.get('/:id/sales', getProductSales);
router.get('/:id', getProduct);
router.patch('/:id', updateProduct);
router.get('/:id/history', getProductHistory);
router.get('/:id/competitors', getProductCompetitors);

export default router;
