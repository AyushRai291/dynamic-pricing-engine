import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required. Add it to apps/api/.env or your environment.`);
  }

  return value;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
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
