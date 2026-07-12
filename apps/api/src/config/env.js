import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required. Add it to apps/api/.env or your environment.`);
  }

  return value;
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
