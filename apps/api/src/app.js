import cors from 'cors';
import express from 'express';

import { errorMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/notFound.middleware.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.middleware.js';
import healthRoutes from './routes/health.routes.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLoggerMiddleware);

app.use('/health', healthRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
