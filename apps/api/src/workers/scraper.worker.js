import { Worker } from 'bullmq';

import { createRedisConnection } from '../config/redis.js';
import {
  SCRAPE_COMPETITOR_JOB_NAME,
  SCRAPER_QUEUE_NAME,
  SCRAPER_WORKER_CONCURRENCY,
} from '../queues/scraper.queue.js';
import { scrapeAndStoreCompetitorData } from '../services/scraper.service.js';

let scraperWorker;
let workerConnection;
let lastWorkerError = null;
let startedAt = null;

function sanitizeScrapeResult(row) {
  return {
    competitorDataId: row.id,
    productId: row.product_id,
    competitorName: row.competitor_name,
    competitorUrl: row.competitor_url,
    price: Number(row.price),
    scrapedAt: row.scraped_at,
  };
}

async function processScrapeJob(job) {
  if (job.name !== SCRAPE_COMPETITOR_JOB_NAME) {
    throw new Error(`Unsupported scraper job type: ${job.name}`);
  }

  const result = await scrapeAndStoreCompetitorData(job.data);
  return sanitizeScrapeResult(result);
}

function ignoreConnectionErrorLogs(redisConnection) {
  if (!redisConnection) {
    return;
  }

  redisConnection.on?.('error', () => {});

  Promise.resolve(redisConnection.client)
    .then((client) => {
      client?.on?.('error', () => {});
    })
    .catch(() => {});
}

export function startScraperWorker() {
  if (scraperWorker) {
    return scraperWorker;
  }

  workerConnection = createRedisConnection({
    commandTimeout: null,
    maxRetriesPerRequest: null,
  });
  scraperWorker = new Worker(SCRAPER_QUEUE_NAME, processScrapeJob, {
    connection: workerConnection,
    concurrency: SCRAPER_WORKER_CONCURRENCY,
  });
  ignoreConnectionErrorLogs(scraperWorker.connection);
  ignoreConnectionErrorLogs(scraperWorker.blockingConnection);
  startedAt = new Date().toISOString();
  lastWorkerError = null;

  scraperWorker.on('completed', (job, result) => {
    console.log(
      `[scraper-worker] completed job ${job.id} (${job.name}) price=${result?.price ?? 'n/a'}`
    );
  });

  scraperWorker.on('failed', (job, error) => {
    console.error(
      `[scraper-worker] failed job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) attempts=${job?.attemptsMade ?? 0}/${job?.opts?.attempts ?? 1}: ${error.message}`
    );
  });

  scraperWorker.on('error', (error) => {
    lastWorkerError = error.message;
    console.error(`[scraper-worker] Redis or worker error: ${error.message}`);
  });

  console.log(`[scraper-worker] started queue=${SCRAPER_QUEUE_NAME} concurrency=${SCRAPER_WORKER_CONCURRENCY}`);
  return scraperWorker;
}

export function getScraperWorkerStatus() {
  return {
    started: Boolean(scraperWorker),
    queueName: SCRAPER_QUEUE_NAME,
    concurrency: SCRAPER_WORKER_CONCURRENCY,
    status: scraperWorker ? 'running' : 'stopped',
    startedAt,
    lastError: lastWorkerError,
  };
}

export async function closeScraperWorker() {
  const worker = scraperWorker;
  const connection = workerConnection;

  scraperWorker = undefined;
  workerConnection = undefined;

  if (worker) {
    await worker.close();
  }

  if (connection && connection.status !== 'end') {
    connection.disconnect();
  }

  startedAt = null;
}
