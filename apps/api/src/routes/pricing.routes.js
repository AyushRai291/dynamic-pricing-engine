import { Router } from 'express';

import {
  approveSuggestion,
  createProductSuggestion,
  generateSuggestionRationale,
  getPricingStatus,
  getSuggestion,
  listSuggestions,
  rejectSuggestion,
  scoreProduct,
} from '../controllers/pricing.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { expensiveMutationRateLimiter } from '../middleware/rateLimit.middleware.js';
import { requireManagerOrAdmin } from '../middleware/role.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/status', getPricingStatus);
router.post('/score/:productId', requireManagerOrAdmin, scoreProduct);
router.post(
  '/products/:id/suggestions',
  requireManagerOrAdmin,
  expensiveMutationRateLimiter,
  createProductSuggestion
);
router.get('/suggestions', listSuggestions);
router.post(
  '/suggestions/:id/rationale',
  requireManagerOrAdmin,
  expensiveMutationRateLimiter,
  generateSuggestionRationale
);
router.post(
  '/suggestions/:id/approve',
  requireManagerOrAdmin,
  expensiveMutationRateLimiter,
  approveSuggestion
);
router.post(
  '/suggestions/:id/reject',
  requireManagerOrAdmin,
  expensiveMutationRateLimiter,
  rejectSuggestion
);
router.get('/suggestions/:id', getSuggestion);

export default router;
