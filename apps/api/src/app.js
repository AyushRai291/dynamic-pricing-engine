import cors from 'cors';
import express from 'express';

import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import authRoutes from './routes/auth.routes.js';
import healthRoutes from './routes/health.routes.js';
import pricingRoutes from './routes/pricing.routes.js';
import productRoutes from './routes/product.routes.js';
import scraperRoutes from './routes/scraper.routes.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLoggerMiddleware);

app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/scraper', scraperRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
