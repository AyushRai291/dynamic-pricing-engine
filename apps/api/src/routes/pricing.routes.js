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

const router = Router();

router.use(authMiddleware);

router.get('/status', getPricingStatus);
router.post('/score/:productId', scoreProduct);
router.post('/products/:id/suggestions', createProductSuggestion);
router.get('/suggestions', listSuggestions);
router.post('/suggestions/:id/rationale', generateSuggestionRationale);
router.post('/suggestions/:id/approve', approveSuggestion);
router.post('/suggestions/:id/reject', rejectSuggestion);
router.get('/suggestions/:id', getSuggestion);

export default router;
