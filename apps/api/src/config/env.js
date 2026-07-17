import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required. Add it to apps/api/.env or your environment.`);
  }

  return value;
}

function parsePositiveInteger(value, name, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }

  return parsed;
}

function parseNonNegativeInteger(value, name, { maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}.`);
  }

  return parsed;
}

function parseNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return value.trim();
}

function parseHttpUrl(value, name) {
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`);
  }

  return parsed.toString().replace(/\/$/, '');
}

export const PORT = process.env.PORT || 5000;
export const DATABASE_URL = process.env.DATABASE_URL;
export const JWT_ACCESS_SECRET = requireEnv('JWT_ACCESS_SECRET');
export const JWT_REFRESH_SECRET = requireEnv('JWT_REFRESH_SECRET');
export const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
export const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
export const TRUST_PROXY = parseNonNegativeInteger(
  process.env.TRUST_PROXY ?? 0,
  'TRUST_PROXY',
  { maximum: 10 }
);
export const RATE_LIMIT_WINDOW_MS = parsePositiveInteger(
  process.env.RATE_LIMIT_WINDOW_MS ?? 60000,
  'RATE_LIMIT_WINDOW_MS',
  { maximum: 3600000 }
);
export const RATE_LIMIT_GENERAL_MAX = parsePositiveInteger(
  process.env.RATE_LIMIT_GENERAL_MAX ?? 120,
  'RATE_LIMIT_GENERAL_MAX',
  { maximum: 100000 }
);
export const RATE_LIMIT_AUTH_MAX = parsePositiveInteger(
  process.env.RATE_LIMIT_AUTH_MAX ?? 20,
  'RATE_LIMIT_AUTH_MAX',
  { maximum: 100000 }
);
export const RATE_LIMIT_EXPENSIVE_MAX = parsePositiveInteger(
  process.env.RATE_LIMIT_EXPENSIVE_MAX ?? 10,
  'RATE_LIMIT_EXPENSIVE_MAX',
  { maximum: 100000 }
);
export const QUEUE_REDIS_CONNECT_TIMEOUT_MS = Number(process.env.QUEUE_REDIS_CONNECT_TIMEOUT_MS || 5000);
export const QUEUE_REDIS_COMMAND_TIMEOUT_MS = Number(process.env.QUEUE_REDIS_COMMAND_TIMEOUT_MS || 5000);
export const SCRAPER_CRON_ENABLED = process.env.SCRAPER_CRON_ENABLED === 'true';
export const SCRAPER_CRON_EXPRESSION = process.env.SCRAPER_CRON_EXPRESSION || '0 */4 * * *';
export const SCRAPER_ALLOW_PRIVATE_URLS = process.env.SCRAPER_ALLOW_PRIVATE_URLS === 'true';
export const ML_SERVICE_URL = parseHttpUrl(
  process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000',
  'ML_SERVICE_URL'
);
export const ML_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.ML_REQUEST_TIMEOUT_MS || 5000,
  'ML_REQUEST_TIMEOUT_MS'
);
export const GEMINI_API_KEY = typeof process.env.GEMINI_API_KEY === 'string'
  && process.env.GEMINI_API_KEY.trim()
  ? process.env.GEMINI_API_KEY.trim()
  : null;
export const GEMINI_MODEL = parseNonEmptyString(
  process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite',
  'GEMINI_MODEL'
);
export const GEMINI_REQUEST_TIMEOUT_MS = parsePositiveInteger(
  process.env.GEMINI_REQUEST_TIMEOUT_MS ?? 10000,
  'GEMINI_REQUEST_TIMEOUT_MS',
  { maximum: 60000 }
);
export const GEMINI_MAX_OUTPUT_TOKENS = parsePositiveInteger(
  process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 600,
  'GEMINI_MAX_OUTPUT_TOKENS',
  { maximum: 8192 }
);
