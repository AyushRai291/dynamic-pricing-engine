import { Router } from 'express';

import {
  getScrapeJobStatus,
  getScraperStatus,
  triggerScrape,
} from '../controllers/scraper.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { expensiveMutationRateLimiter } from '../middleware/rateLimit.middleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/status', getScraperStatus);
router.get('/jobs/:jobId', getScrapeJobStatus);
router.post('/trigger', expensiveMutationRateLimiter, triggerScrape);

export default router;
