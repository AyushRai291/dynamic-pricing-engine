import { Router } from 'express';

import {
  getScrapeJobStatus,
  getScraperStatus,
  triggerScrape,
} from '../controllers/scraper.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { expensiveMutationRateLimiter } from '../middleware/rateLimit.middleware.js';
import { requireManagerOrAdmin } from '../middleware/role.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/status', getScraperStatus);
router.get('/jobs/:jobId', getScrapeJobStatus);
router.post('/trigger', requireManagerOrAdmin, expensiveMutationRateLimiter, triggerScrape);

export default router;
