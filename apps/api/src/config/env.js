import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || !value.trim()) {
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

function parseBoolean(value, name, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
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

function parseCorsAllowedOrigins(value, { production }) {
  const configured = typeof value === 'string' && value.trim()
    ? value.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  const origins = configured.length > 0
    ? configured
    : production
      ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  if (origins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS is required in production.');
  }

  return [...new Set(origins.map((origin) => {
    let parsed;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain valid HTTP or HTTPS origins.');
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain valid HTTP or HTTPS origins.');
    }

    return parsed.origin;
  }))];
}

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = process.env.PORT || 5000;
export const DATABASE_URL = NODE_ENV === 'production'
  ? requireEnv('DATABASE_URL')
  : process.env.DATABASE_URL;
export const JWT_ACCESS_SECRET = requireEnv('JWT_ACCESS_SECRET');
export const JWT_REFRESH_SECRET = requireEnv('JWT_REFRESH_SECRET');
export const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
export const CORS_ALLOWED_ORIGINS = parseCorsAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS,
  { production: NODE_ENV === 'production' }
);
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
export const SCRAPER_ALLOW_PRIVATE_URLS = process.env.SCRAPER_ALLOW_PRIVATE_URLS === 'true'
  && ['development', 'test'].includes(NODE_ENV);
export const SCRAPER_DISABLE_CHROMIUM_SANDBOX = parseBoolean(
  process.env.SCRAPER_DISABLE_CHROMIUM_SANDBOX,
  'SCRAPER_DISABLE_CHROMIUM_SANDBOX'
);
export const SCRAPER_MAX_HTML_BYTES = parsePositiveInteger(
  process.env.SCRAPER_MAX_HTML_BYTES ?? 2000000,
  'SCRAPER_MAX_HTML_BYTES',
  { maximum: 10000000 }
);
export const SCRAPER_MAX_REDIRECTS = parsePositiveInteger(
  process.env.SCRAPER_MAX_REDIRECTS ?? 5,
  'SCRAPER_MAX_REDIRECTS',
  { maximum: 20 }
);
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
