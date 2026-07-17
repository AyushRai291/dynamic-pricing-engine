import { rateLimit } from 'express-rate-limit';

import {
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_EXPENSIVE_MAX,
  RATE_LIMIT_GENERAL_MAX,
  RATE_LIMIT_WINDOW_MS,
} from '../config/env.js';

const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.';

export const RATE_LIMIT_POLICIES = Object.freeze({
  general: Object.freeze({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_GENERAL_MAX }),
  auth: Object.freeze({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_AUTH_MAX }),
  expensive: Object.freeze({ windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_EXPENSIVE_MAX }),
});

export function rateLimitExceededHandler(req, res) {
  res.status(429).json({
    error: {
      message: RATE_LIMIT_MESSAGE,
      statusCode: 429,
      requestId: req.requestId,
    },
  });
}

export function createRateLimiter(policy) {
  return rateLimit({
    ...policy,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitExceededHandler,
  });
}

// The default in-memory stores are appropriate for this single-instance MVP.
// Multi-replica deployments will require a shared store, but Redis is intentionally out of scope today.
export const generalApiRateLimiter = createRateLimiter(RATE_LIMIT_POLICIES.general);
export const authRateLimiter = createRateLimiter(RATE_LIMIT_POLICIES.auth);
export const expensiveMutationRateLimiter = createRateLimiter(RATE_LIMIT_POLICIES.expensive);
