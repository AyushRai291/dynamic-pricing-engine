import {
  enqueueScrapeJob,
  getScrapeJobStatus as getScrapeJobStatusData,
  getScraperQueueStats,
} from '../queues/scraper.queue.js';
import { getScraperSchedulerStatus } from '../schedulers/scraper.scheduler.js';
import { SCRAPER_ALLOW_PRIVATE_URLS } from '../config/env.js';
import { getActiveCompetitorTarget } from '../services/competitorTarget.service.js';
import { assertProductExists } from '../services/scraper.service.js';
import { getScraperWorkerStatus } from '../workers/scraper.worker.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCompetitorUrl } from '../utils/competitorUrl.js';

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

export function validateScraperUuid(id, fieldName) {
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw createError(`Invalid ${fieldName}`, 400);
  }

  return id;
}

function validateJobId(jobId) {
  if (typeof jobId !== 'string' || !jobId.trim()) {
    throw createError('Invalid jobId', 400);
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

export function createTriggerScrapeHandler({
  enqueueFn = enqueueScrapeJob,
  getActiveTargetFn = getActiveCompetitorTarget,
  assertProductExistsFn = assertProductExists,
  allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS,
} = {}) {
  return asyncHandler(async (req, res) => {
    const body = req.body || {};
    const mockHtml = parseOptionalMockHtml(body);
    let payload;

    if (body.targetId !== undefined) {
      const targetId = parseRequiredString(body, 'targetId');

      validateScraperUuid(targetId, 'targetId');
      const target = await getActiveTargetFn(targetId);

      validateCompetitorUrl(target.competitorUrl, {
        allowPrivateUrls: allowPrivateUrls || Boolean(mockHtml),
        allowInvalidForMockHtml: Boolean(mockHtml),
      });
      payload = {
        productId: target.productId,
        competitorName: target.competitorName,
        competitorUrl: target.competitorUrl,
        mockHtml,
      };
    } else {
      const productId = parseRequiredString(body, 'productId');
      const competitorName = parseRequiredString(body, 'competitorName');
      const competitorUrl = parseRequiredString(body, 'competitorUrl');

      validateScraperUuid(productId, 'productId');
      validateCompetitorUrl(competitorUrl, {
        allowPrivateUrls: allowPrivateUrls || Boolean(mockHtml),
        allowInvalidForMockHtml: Boolean(mockHtml),
      });
      await assertProductExistsFn(productId);
      payload = { productId, competitorName, competitorUrl, mockHtml };
    }

    const job = await enqueueFn(payload);

    res.status(202).json({
      message: 'Scrape queued',
      job,
    });
  });
}

export const triggerScrape = createTriggerScrapeHandler();
