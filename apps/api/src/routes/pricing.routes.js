import { Router } from 'express';

import {
  createProductSuggestion,
  getPricingStatus,
  getSuggestion,
  listSuggestions,
  scoreProduct,
} from '../controllers/pricing.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/status', getPricingStatus);
router.post('/score/:productId', scoreProduct);
router.post('/products/:id/suggestions', createProductSuggestion);
router.get('/suggestions', listSuggestions);
router.get('/suggestions/:id', getSuggestion);

export default router;
