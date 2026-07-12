import IORedis from 'ioredis';

import {
  QUEUE_REDIS_COMMAND_TIMEOUT_MS,
  QUEUE_REDIS_CONNECT_TIMEOUT_MS,
  REDIS_URL,
} from './env.js';

export function createRedisConnection({
  commandTimeout = QUEUE_REDIS_COMMAND_TIMEOUT_MS,
  maxRetriesPerRequest = 1,
  onError,
} = {}) {
  const options = {
    connectTimeout: QUEUE_REDIS_CONNECT_TIMEOUT_MS,
    enableReadyCheck: true,
    maxRetriesPerRequest,
    retryStrategy(times) {
      return Math.min(times * 250, 2000);
    },
  };

  if (commandTimeout !== null) {
    options.commandTimeout = commandTimeout;
  }

  const connection = new IORedis(REDIS_URL, options);

  connection.on('error', onError || (() => {}));

  return connection;
}

export function createQueueUnavailableError() {
  const error = new Error('Scraper queue is unavailable. Check REDIS_URL and ensure Redis is running.');
  error.statusCode = 503;
  return error;
}
