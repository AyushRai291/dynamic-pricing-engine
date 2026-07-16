import { SCRAPER_ALLOW_PRIVATE_URLS } from '../config/env.js';
import {
  createCompetitorTarget,
  listCompetitorTargets,
  updateCompetitorTarget,
} from '../services/competitorTarget.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateCompetitorUrl } from '../utils/competitorUrl.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CREATE_FIELDS = new Set(['competitorName', 'competitorUrl']);
const PATCH_FIELDS = new Set(['competitorName', 'competitorUrl', 'isActive']);

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function validateTargetUuid(id, entityName) {
  if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
    throw createError(`Invalid ${entityName} id`, 400);
  }

  return id;
}

function validateBodyShape(body, allowedFields) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw createError('Request body must be a JSON object', 400);
  }

  const invalidField = Object.keys(body).find((field) => !allowedFields.has(field));

  if (invalidField) {
    throw createError(`${invalidField} cannot be set`, 400);
  }
}

function parseCompetitorName(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createError('competitorName is required', 400);
  }

  return value.trim();
}

export function parseCreateTargetBody(
  body,
  { allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS } = {}
) {
  validateBodyShape(body, CREATE_FIELDS);

  return {
    competitorName: parseCompetitorName(body.competitorName),
    competitorUrl: validateCompetitorUrl(body.competitorUrl, { allowPrivateUrls }),
  };
}

export function parsePatchTargetBody(
  body,
  { allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS } = {}
) {
  validateBodyShape(body, PATCH_FIELDS);
  const fields = Object.keys(body);

  if (fields.length === 0) {
    throw createError('At least one field is required', 400);
  }

  const changes = {};

  if (Object.hasOwn(body, 'competitorName')) {
    changes.competitorName = parseCompetitorName(body.competitorName);
  }

  if (Object.hasOwn(body, 'competitorUrl')) {
    changes.competitorUrl = validateCompetitorUrl(body.competitorUrl, { allowPrivateUrls });
  }

  if (Object.hasOwn(body, 'isActive')) {
    if (typeof body.isActive !== 'boolean') {
      throw createError('isActive must be a boolean', 400);
    }

    changes.isActive = body.isActive;
  }

  return changes;
}

export function createListCompetitorTargetsHandler({ listFn = listCompetitorTargets } = {}) {
  return asyncHandler(async (req, res) => {
    const productId = validateTargetUuid(req.params.id, 'product');
    const items = await listFn(productId);

    res.status(200).json({ items });
  });
}

export function createCreateCompetitorTargetHandler({
  createFn = createCompetitorTarget,
  allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS,
} = {}) {
  return asyncHandler(async (req, res) => {
    const productId = validateTargetUuid(req.params.id, 'product');
    const target = parseCreateTargetBody(req.body, { allowPrivateUrls });
    const createdTarget = await createFn(productId, target);

    res.status(201).json({ target: createdTarget });
  });
}

export function createUpdateCompetitorTargetHandler({
  updateFn = updateCompetitorTarget,
  allowPrivateUrls = SCRAPER_ALLOW_PRIVATE_URLS,
} = {}) {
  return asyncHandler(async (req, res) => {
    const productId = validateTargetUuid(req.params.id, 'product');
    const targetId = validateTargetUuid(req.params.targetId, 'target');
    const changes = parsePatchTargetBody(req.body, { allowPrivateUrls });
    const target = await updateFn(productId, targetId, changes);

    res.status(200).json({ target });
  });
}

export const listProductCompetitorTargets = createListCompetitorTargetsHandler();
export const createProductCompetitorTarget = createCreateCompetitorTargetHandler();
export const updateProductCompetitorTarget = createUpdateCompetitorTargetHandler();
