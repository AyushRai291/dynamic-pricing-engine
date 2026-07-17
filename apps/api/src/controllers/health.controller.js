import { checkDatabaseReadiness } from '../services/health.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function createReadinessHandler({
  checkDatabaseFn = checkDatabaseReadiness,
} = {}) {
  return asyncHandler(async (req, res) => {
    try {
      await checkDatabaseFn();
    } catch {
      throw createError('Service unavailable', 503);
    }

    res.status(200).json({
      status: 'ready',
      service: 'dynamic-pricing-api',
      database: 'ready',
    });
  });
}

export const readiness = createReadinessHandler();
