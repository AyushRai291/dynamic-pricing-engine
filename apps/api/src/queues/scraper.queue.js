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

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

export async function enqueueScrapeJob(payload, { jobId, skipIfExists = false } = {}) {
  const queue = getQueue();

  try {
    if (jobId && skipIfExists) {
      const existingJob = await withQueueTimeout(queue.getJob(jobId));

      if (existingJob) {
        const state = await withQueueTimeout(existingJob.getState()).catch(() => 'queued');

        return {
          id: existingJob.id,
          name: existingJob.name,
          state,
          duplicate: true,
        };
      }
    }

    const options = jobId ? { jobId } : undefined;
    const job = await withQueueTimeout(queue.add(SCRAPE_COMPETITOR_JOB_NAME, payload, options));
    const state = await withQueueTimeout(job.getState()).catch(() => 'queued');
    const result = {
      id: job.id,
      name: job.name,
      state,
    };

    if (skipIfExists) {
      result.duplicate = false;
    }

    return result;
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

function safeLabel(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

export function sanitizeFailureReason(reason) {
  if (typeof reason !== 'string' || !reason.trim()) {
    return 'Scrape job failed';
  }

  const safeReasons = [
    'Price could not be parsed from HTML',
    'Product not found',
    'competitorUrl host is not allowed',
  ];
  const safeReason = safeReasons.find((candidate) => reason.includes(candidate));

  return safeReason || 'Scrape job failed';
}

function toIsoTimestamp(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

export async function summarizeScrapeJob(job, knownState) {
  const state = knownState || await job.getState();
  const progress = typeof job.progress === 'number' && Number.isFinite(job.progress)
    ? Math.min(100, Math.max(0, job.progress))
    : null;

  return {
    jobId: String(job.id),
    state,
    targetId: safeLabel(job.data?.targetId),
    productId: safeLabel(job.data?.productId),
    productName: safeLabel(job.data?.productName),
    competitorName: safeLabel(job.data?.competitorName),
    attemptsMade: Number(job.attemptsMade) || 0,
    maxAttempts: Number(job.opts?.attempts) || 1,
    queuedAt: toIsoTimestamp(job.timestamp),
    processedOn: toIsoTimestamp(job.processedOn),
    finishedOn: toIsoTimestamp(job.finishedOn),
    progress,
    failureReason: state === 'failed' ? sanitizeFailureReason(job.failedReason) : null,
  };
}

export async function listRecentScrapeJobs(
  { state, page, limit },
  { queueFn = getQueue } = {}
) {
  const queue = queueFn();
  const states = state
    ? [state]
    : ['waiting', 'active', 'delayed', 'completed', 'failed'];
  const start = (page - 1) * limit;
  const end = start + limit - 1;

  try {
    const [jobs, counts] = await Promise.all([
      withQueueTimeout(queue.getJobs(states, start, end, false)),
      withQueueTimeout(queue.getJobCounts(...states)),
    ]);
    const items = await Promise.all(
      jobs.map((job) => withQueueTimeout(summarizeScrapeJob(job, state)))
    );
    const total = states.reduce((sum, jobState) => sum + (counts[jobState] || 0), 0);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    throw mapQueueError(error);
  }
}

async function getFailedJob(queue, jobId) {
  const job = await withQueueTimeout(queue.getJob(jobId));

  if (!job) {
    throw createError('Scraper job not found', 404);
  }

  const state = await withQueueTimeout(job.getState());

  if (state !== 'failed') {
    throw createError('Only failed scraper jobs can be retried', 409);
  }

  return job;
}

export async function getFailedScrapeJobTargetId(jobId, { queueFn = getQueue } = {}) {
  try {
    const job = await getFailedJob(queueFn(), jobId);
    const targetId = job.data?.targetId;

    if (typeof targetId !== 'string' || !targetId.trim()) {
      throw createError('Scraper job is not linked to a configured target', 409);
    }

    return targetId.trim();
  } catch (error) {
    throw mapQueueError(error);
  }
}

export async function retryFailedScrapeJob(
  jobId,
  trustedPayload,
  { queueFn = getQueue } = {}
) {
  try {
    const job = await getFailedJob(queueFn(), jobId);
    await withQueueTimeout(job.updateData(trustedPayload));
    await withQueueTimeout(job.retry('failed'));

    return summarizeScrapeJob(job, await withQueueTimeout(job.getState()));
  } catch (error) {
    throw mapQueueError(error);
  }
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
