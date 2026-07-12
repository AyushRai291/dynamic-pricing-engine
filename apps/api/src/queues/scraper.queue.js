import { Queue } from 'bullmq';

import { QUEUE_REDIS_COMMAND_TIMEOUT_MS } from '../config/env.js';
import { createQueueUnavailableError, createRedisConnection } from '../config/redis.js';

export const SCRAPER_QUEUE_NAME = 'scraper-jobs';
export const SCRAPE_COMPETITOR_JOB_NAME = 'scrape-competitor';
export const SCRAPER_JOB_ATTEMPTS = 3;
export const SCRAPER_JOB_BACKOFF = {
  type: 'exponential',
  delay: 1000,
};
export const SCRAPER_JOB_REMOVE_ON_COMPLETE = {
  age: 24 * 60 * 60,
  count: 100,
};
export const SCRAPER_JOB_REMOVE_ON_FAIL = {
  age: 7 * 24 * 60 * 60,
  count: 1000,
};
export const SCRAPER_WORKER_CONCURRENCY = 1;

let scraperQueue;
let queueConnection;

function withQueueTimeout(promise) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(createQueueUnavailableError());
    }, QUEUE_REDIS_COMMAND_TIMEOUT_MS + 1000);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

function mapQueueError(error) {
  if (error?.statusCode) {
    return error;
  }

  return createQueueUnavailableError();
}

function getQueue() {
  if (!scraperQueue) {
    queueConnection = createRedisConnection({ maxRetriesPerRequest: 1 });
    scraperQueue = new Queue(SCRAPER_QUEUE_NAME, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: SCRAPER_JOB_ATTEMPTS,
        backoff: SCRAPER_JOB_BACKOFF,
        removeOnComplete: SCRAPER_JOB_REMOVE_ON_COMPLETE,
        removeOnFail: SCRAPER_JOB_REMOVE_ON_FAIL,
      },
    });
  }

  return scraperQueue;
}

export async function checkScraperQueueAvailability() {
  const queue = getQueue();

  try {
    const client = await withQueueTimeout(queue.client);
    await withQueueTimeout(client.ping());
  } catch (error) {
    throw mapQueueError(error);
  }
}

export async function enqueueScrapeJob(payload) {
  const queue = getQueue();

  try {
    const job = await withQueueTimeout(queue.add(SCRAPE_COMPETITOR_JOB_NAME, payload));
    const state = await withQueueTimeout(job.getState()).catch(() => 'queued');

    return {
      id: job.id,
      name: job.name,
      state,
    };
  } catch (error) {
    throw mapQueueError(error);
  }
}

function sanitizeJobResult(result) {
  if (!result) {
    return undefined;
  }

  return {
    competitorDataId: result.competitorDataId,
    productId: result.productId,
    competitorName: result.competitorName,
    competitorUrl: result.competitorUrl,
    price: result.price,
    scrapedAt: result.scrapedAt,
  };
}

export async function getScrapeJobStatus(jobId) {
  const queue = getQueue();
  let job;

  try {
    job = await withQueueTimeout(queue.getJob(jobId));
  } catch (error) {
    throw mapQueueError(error);
  }

  if (!job) {
    const error = new Error('Scraper job not found');
    error.statusCode = 404;
    throw error;
  }

  try {
    const state = await withQueueTimeout(job.getState());
    const status = {
      id: job.id,
      name: job.name,
      state,
      attemptsMade: job.attemptsMade,
      attemptsConfigured: job.opts.attempts || 1,
      queuedAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    };

    if (state === 'completed') {
      status.result = sanitizeJobResult(job.returnvalue);
    }

    if (state === 'failed') {
      status.failureReason = job.failedReason;
    }

    return status;
  } catch (error) {
    throw mapQueueError(error);
  }
}

export async function getScraperQueueStats() {
  const queue = getQueue();

  try {
    const counts = await withQueueTimeout(
      queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused')
    );
    const paused = await withQueueTimeout(queue.isPaused());

    return {
      name: SCRAPER_QUEUE_NAME,
      available: true,
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      delayed: counts.delayed || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      paused: counts.paused || 0,
      isPaused: paused,
    };
  } catch (error) {
    throw mapQueueError(error);
  }
}

export async function closeScraperQueue() {
  const queue = scraperQueue;
  const connection = queueConnection;

  scraperQueue = undefined;
  queueConnection = undefined;

  if (queue) {
    await queue.close();
  }

  if (connection && connection.status !== 'end') {
    connection.disconnect();
  }
}
