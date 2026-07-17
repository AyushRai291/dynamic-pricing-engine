import cors from 'cors';
import express from 'express';

import { CORS_ALLOWED_ORIGINS, TRUST_PROXY } from './config/env.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { authRateLimiter, generalApiRateLimiter } from './middleware/rateLimit.middleware.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import adminRoutes from './routes/admin.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import authRoutes from './routes/auth.routes.js';
import competitorTargetRoutes from './routes/competitorTarget.routes.js';
import healthRoutes from './routes/health.routes.js';
import pricingRoutes from './routes/pricing.routes.js';
import productRoutes from './routes/product.routes.js';
import scraperRoutes from './routes/scraper.routes.js';

const app = express();

function corsOrigin(origin, callback) {
  if (!origin || CORS_ALLOWED_ORIGINS.includes(origin)) {
    callback(null, true);
    return;
  }

  const error = new Error('Origin is not allowed');
  error.statusCode = 403;
  callback(error);
}

app.set('trust proxy', TRUST_PROXY);
app.use(requestIdMiddleware);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
app.use(requestLoggerMiddleware);

app.use('/health', healthRoutes);
app.use('/api', generalApiRateLimiter);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/competitor-targets', competitorTargetRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/scraper', scraperRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
