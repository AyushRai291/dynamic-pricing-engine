import { getAnalyticsOverview as getAnalyticsOverviewData } from '../services/analytics.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const MAX_ANALYTICS_RANGE_DAYS = 366;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseDate(value, fieldName) {
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
    throw createError(`${fieldName} must use YYYY-MM-DD`, 400);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw createError(`${fieldName} must be a valid date`, 400);
  }

  return date;
}

export function parseAnalyticsOverviewQuery(query = {}) {
  const invalidField = Object.keys(query).find((field) => !['from', 'to'].includes(field));
  if (invalidField) throw createError(`Invalid query field: ${invalidField}`, 400);

  const fromDate = parseDate(query.from, 'from');
  const toDate = parseDate(query.to, 'to');
  const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;

  if (rangeDays < 1) throw createError('from must be on or before to', 400);
  if (rangeDays > MAX_ANALYTICS_RANGE_DAYS) {
    throw createError(`Date range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days`, 400);
  }

  return { from: query.from, to: query.to };
}

export function createGetAnalyticsOverviewHandler({
  getOverviewFn = getAnalyticsOverviewData,
} = {}) {
  return asyncHandler(async (req, res) => {
    const result = await getOverviewFn(parseAnalyticsOverviewQuery(req.query));
    res.status(200).json(result);
  });
}

export const getAnalyticsOverview = createGetAnalyticsOverviewHandler();
