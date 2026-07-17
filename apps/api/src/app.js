import cors from 'cors';
import express from 'express';

import { TRUST_PROXY } from './config/env.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { authRateLimiter, generalApiRateLimiter } from './middleware/rateLimit.middleware.js';
import { requestIdMiddleware } from './middleware/requestId.middleware.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import analyticsRoutes from './routes/analytics.routes.js';
import authRoutes from './routes/auth.routes.js';
import competitorTargetRoutes from './routes/competitorTarget.routes.js';
import healthRoutes from './routes/health.routes.js';
import pricingRoutes from './routes/pricing.routes.js';
import productRoutes from './routes/product.routes.js';
import scraperRoutes from './routes/scraper.routes.js';

const app = express();

app.set('trust proxy', TRUST_PROXY);
app.use(requestIdMiddleware);
app.use(cors());
app.use(express.json());
app.use(requestLoggerMiddleware);

app.use('/health', healthRoutes);
app.use('/api', generalApiRateLimiter);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/competitor-targets', competitorTargetRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/scraper', scraperRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
