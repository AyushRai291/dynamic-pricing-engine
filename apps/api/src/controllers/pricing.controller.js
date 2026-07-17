import { getMlHealth } from '../services/ml.service.js';
import {
  approvePriceSuggestion,
  createPendingPriceSuggestion,
  generatePriceSuggestionRationale,
  getPriceSuggestionById,
  listPriceSuggestions,
  listGlobalPriceHistory,
  rejectPriceSuggestion,
  scoreProductPricing,
} from '../services/pricing.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUGGESTION_STATUSES = new Set(['pending', 'approved', 'rejected', 'expired']);
const DEFAULT_SUGGESTION_LIMIT = 20;
const MAX_SUGGESTION_LIMIT = 100;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function validatePricingUuid(id, entityName) {
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw createError(`Invalid ${entityName} id`, 400);
  }

  return id;
}

export function validateCreateSuggestionBody(body) {
  if (body === undefined) {
    return;
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw createError('Request body must be an empty JSON object', 400);
  }

  if (Object.keys(body).length > 0) {
    throw createError('Request body must not contain fields', 400);
  }
}

export function parseSuggestionListQuery(query) {
  const invalidField = Object.keys(query).find((key) => !['status', 'limit'].includes(key));

  if (invalidField) {
    throw createError(`Invalid query field: ${invalidField}`, 400);
  }

  const status = query.status === undefined ? 'pending' : query.status;

  if (typeof status !== 'string' || !SUGGESTION_STATUSES.has(status)) {
    throw createError('status must be pending, approved, rejected, or expired', 400);
  }

  let limit = DEFAULT_SUGGESTION_LIMIT;

  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)) {
      throw createError(`limit must be an integer between 1 and ${MAX_SUGGESTION_LIMIT}`, 400);
    }

    limit = Number(query.limit);

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SUGGESTION_LIMIT) {
      throw createError(`limit must be an integer between 1 and ${MAX_SUGGESTION_LIMIT}`, 400);
    }
  }

  return { status, limit };
}

function parseOptionalDate(value, fieldName) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !DATE_REGEX.test(value)) {
    throw createError(`${fieldName} must use YYYY-MM-DD`, 400);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw createError(`${fieldName} must be a valid date`, 400);
  }
  return value;
}

export function parsePriceHistoryQuery(query = {}) {
  const allowedFields = ['productId', 'from', 'to', 'page', 'limit'];
  const invalidField = Object.keys(query).find((field) => !allowedFields.includes(field));
  if (invalidField) throw createError(`Invalid query field: ${invalidField}`, 400);

  const productId = query.productId === undefined
    ? undefined
    : validatePricingUuid(query.productId, 'product');
  const from = parseOptionalDate(query.from, 'from');
  const to = parseOptionalDate(query.to, 'to');
  if (from && to && from > to) throw createError('from must be on or before to', 400);

  function parsePageValue(value, fieldName, defaultValue, maximum) {
    if (value === undefined) return defaultValue;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
      throw createError(`${fieldName} must be an integer between 1 and ${maximum}`, 400);
    }
    const parsed = Number(value);
    if (parsed < 1 || parsed > maximum) {
      throw createError(`${fieldName} must be an integer between 1 and ${maximum}`, 400);
    }
    return parsed;
  }

  return {
    productId,
    from,
    to,
    page: parsePageValue(query.page, 'page', 1, Number.MAX_SAFE_INTEGER),
    limit: parsePageValue(query.limit, 'limit', 20, 100),
  };
}

export const getPricingStatus = asyncHandler(async (req, res) => {
  const mlHealth = await getMlHealth();

  res.status(200).json({
    status: 'ok',
    ml_service: mlHealth,
  });
});

export const scoreProduct = asyncHandler(async (req, res) => {
  validatePricingUuid(req.params.productId, 'product');

  const result = await scoreProductPricing(req.params.productId);

  res.status(200).json(result);
});

export function createProductSuggestionHandler({ createFn = createPendingPriceSuggestion } = {}) {
  return asyncHandler(async (req, res) => {
    const productId = validatePricingUuid(req.params.id, 'product');
    validateCreateSuggestionBody(req.body);
    const suggestion = await createFn(productId);

    res.status(201).json({ suggestion });
  });
}

export function createListSuggestionsHandler({ listFn = listPriceSuggestions } = {}) {
  return asyncHandler(async (req, res) => {
    const filters = parseSuggestionListQuery(req.query);
    const result = await listFn(filters);

    res.status(200).json(result);
  });
}

export function createListPriceHistoryHandler({ listFn = listGlobalPriceHistory } = {}) {
  return asyncHandler(async (req, res) => {
    const result = await listFn(parsePriceHistoryQuery(req.query));
    res.status(200).json(result);
  });
}

export function createGetSuggestionHandler({ getFn = getPriceSuggestionById } = {}) {
  return asyncHandler(async (req, res) => {
    const suggestionId = validatePricingUuid(req.params.id, 'suggestion');
    const suggestion = await getFn(suggestionId);

    res.status(200).json({ suggestion });
  });
}

export function createGenerateSuggestionRationaleHandler({
  generateFn = generatePriceSuggestionRationale,
} = {}) {
  return asyncHandler(async (req, res) => {
    const suggestionId = validatePricingUuid(req.params.id, 'suggestion');
    validateCreateSuggestionBody(req.body);
    const result = await generateFn(suggestionId);

    res.status(result.generated ? 201 : 200).json(result);
  });
}

export function createApproveSuggestionHandler({ approveFn = approvePriceSuggestion } = {}) {
  return asyncHandler(async (req, res) => {
    const suggestionId = validatePricingUuid(req.params.id, 'suggestion');
    validateCreateSuggestionBody(req.body);
    const result = await approveFn(suggestionId, req.user.id);

    res.status(200).json(result);
  });
}

export function createRejectSuggestionHandler({ rejectFn = rejectPriceSuggestion } = {}) {
  return asyncHandler(async (req, res) => {
    const suggestionId = validatePricingUuid(req.params.id, 'suggestion');
    validateCreateSuggestionBody(req.body);
    const suggestion = await rejectFn(suggestionId);

    res.status(200).json({ suggestion });
  });
}

export const createProductSuggestion = createProductSuggestionHandler();
export const listSuggestions = createListSuggestionsHandler();
export const listPriceHistory = createListPriceHistoryHandler();
export const getSuggestion = createGetSuggestionHandler();
export const generateSuggestionRationale = createGenerateSuggestionRationaleHandler();
export const approveSuggestion = createApproveSuggestionHandler();
export const rejectSuggestion = createRejectSuggestionHandler();
