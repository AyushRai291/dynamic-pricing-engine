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
import {
  createProductCompetitorTarget,
  listProductCompetitorTargets,
  updateProductCompetitorTarget,
} from '../controllers/competitorTarget.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireManagerOrAdmin } from '../middleware/role.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', listProducts);
router.post('/', requireManagerOrAdmin, createProduct);
router.post('/:id/sales/bulk', requireManagerOrAdmin, bulkUpsertProductSales);
router.get('/:id/sales', getProductSales);
router.get('/:id/competitor-targets', listProductCompetitorTargets);
router.post('/:id/competitor-targets', requireManagerOrAdmin, createProductCompetitorTarget);
router.patch(
  '/:id/competitor-targets/:targetId',
  requireManagerOrAdmin,
  updateProductCompetitorTarget
);
router.get('/:id', getProduct);
router.patch('/:id', requireManagerOrAdmin, updateProduct);
router.get('/:id/history', getProductHistory);
router.get('/:id/competitors', getProductCompetitors);

export default router;
