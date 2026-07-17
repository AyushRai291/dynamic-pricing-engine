import { Router } from 'express';

import { readiness } from '../controllers/health.controller.js';

const router = Router();

router.get('/ready', readiness);

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'dynamic-pricing-api'
  });
});

export default router;
