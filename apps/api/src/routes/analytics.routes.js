import { Router } from 'express';

import { getAnalyticsOverview } from '../controllers/analytics.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);
router.get('/overview', getAnalyticsOverview);

export default router;
