import {
  enqueueScrapeJob,
  getScrapeJobStatus as getScrapeJobStatusData,
  getScraperQueueStats,
} from '../queues/scraper.queue.js';
import { getScraperSchedulerStatus } from '../schedulers/scraper.scheduler.js';
import { assertProductExists } from '../services/scraper.service.js';
import { getScraperWorkerStatus } from '../workers/scraper.worker.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseRequiredString(body, fieldName) {
  const value = body[fieldName];

  if (typeof value !== 'string' || !value.trim()) {
    throw createError(`${fieldName} is required`, 400);
  }

  return value.trim();
}

function parseOptionalMockHtml(body) {
  if (body.mockHtml === undefined || body.mockHtml === null) {
    return undefined;
  }

  if (typeof body.mockHtml !== 'string' || !body.mockHtml.trim()) {
    throw createError('mockHtml must be a non-empty string', 400);
  }

  return body.mockHtml;
}

function validateProductId(productId) {
  if (!UUID_REGEX.test(productId)) {
    throw createError('Invalid productId', 400);
  }
}

function validateJobId(jobId) {
  if (typeof jobId !== 'string' || !jobId.trim()) {
    throw createError('Invalid jobId', 400);
  }
}

function validateCompetitorUrl(competitorUrl, hasMockHtml) {
  let url;

  try {
    url = new URL(competitorUrl);
  } catch {
    if (hasMockHtml) {
      return;
    }

    throw createError('competitorUrl must be a valid HTTP or HTTPS URL', 400);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createError('competitorUrl must be an HTTP or HTTPS URL', 400);
  }
}

export const getScraperStatus = asyncHandler(async (req, res) => {
  const queue = await getScraperQueueStats();

  res.status(200).json({
    status: 'ok',
    mode: 'queue',
    queue,
    worker: getScraperWorkerStatus(),
    scheduler: getScraperSchedulerStatus(),
  });
});

export const getScrapeJobStatus = asyncHandler(async (req, res) => {
  const jobId = req.params.jobId;

  validateJobId(jobId);

  const job = await getScrapeJobStatusData(jobId.trim());

  res.status(200).json({ job });
});

export const triggerScrape = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const productId = parseRequiredString(body, 'productId');
  const competitorName = parseRequiredString(body, 'competitorName');
  const competitorUrl = parseRequiredString(body, 'competitorUrl');
  const mockHtml = parseOptionalMockHtml(body);

  validateProductId(productId);
  validateCompetitorUrl(competitorUrl, Boolean(mockHtml));
  await assertProductExists(productId);

  const job = await enqueueScrapeJob({
    productId,
    competitorName,
    competitorUrl,
    mockHtml,
  });

  res.status(202).json({
    message: 'Scrape queued',
    job,
  });
});
