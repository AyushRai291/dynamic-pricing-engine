import { Router } from 'express';

import { getPricingStatus, scoreProduct } from '../controllers/pricing.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/status', getPricingStatus);
router.post('/score/:productId', scoreProduct);

export default router;
