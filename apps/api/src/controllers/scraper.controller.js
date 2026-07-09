import {
  getScraperStatus as getScraperStatusData,
  triggerScrape as triggerScrapeRun,
} from '../services/scraper.service.js';
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

export const getScraperStatus = asyncHandler(async (req, res) => {
  res.status(200).json(getScraperStatusData());
});

export const triggerScrape = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const productId = parseRequiredString(body, 'productId');
  const competitorName = parseRequiredString(body, 'competitorName');
  const competitorUrl = parseRequiredString(body, 'competitorUrl');
  const mockHtml = parseOptionalMockHtml(body);

  validateProductId(productId);

  const data = await triggerScrapeRun({
    productId,
    competitorName,
    competitorUrl,
    mockHtml,
  });

  res.status(201).json({
    message: 'Scrape completed',
    data,
  });
});
