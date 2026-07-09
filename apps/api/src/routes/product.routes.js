import { Router } from 'express';

import {
  createProduct,
  getProduct,
  getProductCompetitors,
  getProductHistory,
  listProducts,
  updateProduct,
} from '../controllers/product.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', listProducts);
router.post('/', createProduct);
router.get('/:id', getProduct);
router.patch('/:id', updateProduct);
router.get('/:id/history', getProductHistory);
router.get('/:id/competitors', getProductCompetitors);

export default router;
