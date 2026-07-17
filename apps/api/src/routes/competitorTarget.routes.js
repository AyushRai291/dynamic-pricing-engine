import { Router } from 'express';

import { listConfiguredCompetitorTargets } from '../controllers/competitorTarget.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.use(authMiddleware);
router.get('/', listConfiguredCompetitorTargets);

export default router;
