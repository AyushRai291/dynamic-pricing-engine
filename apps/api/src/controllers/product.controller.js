import {
  createProduct as createProductRecord,
  getProductById,
  getProductCompetitors as getProductCompetitorRows,
  getProductHistory as getProductHistoryRows,
  listProducts as listProductRecords,
  updateProduct as updateProductRecord,
} from '../services/product.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATCH_FIELDS = [
  'name',
  'category',
  'current_price',
  'cost_price',
  'min_price',
  'max_price',
  'inventory_count',
  'is_active',
  'metadata',
];

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parsePositiveInteger(value, defaultValue, fieldName) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw createError(`${fieldName} must be a positive integer`, 400);
  }

  return parsed;
}

function parseBooleanFilter(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw createError('isActive must be true or false', 400);
}

function requireUuid(id) {
  if (!UUID_REGEX.test(id)) {
    throw createError('Invalid product id', 400);
  }
}

function parseRequiredString(body, fieldName) {
  const value = body[fieldName];

  if (typeof value !== 'string' || !value.trim()) {
    throw createError(`${fieldName} is required`, 400);
  }

  return value.trim();
}

function parseOptionalString(body, fieldName) {
  const value = body[fieldName];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw createError(`${fieldName} must be a string`, 400);
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseMoney(body, fieldName, isRequired) {
  const value = body[fieldName];

  if (value === undefined || value === null || value === '') {
    if (isRequired) {
      throw createError(`${fieldName} is required`, 400);
    }

    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw createError(`${fieldName} must be a number`, 400);
  }

  return parsed;
}

function parseInventory(body, isRequired) {
  const value = body.inventory_count;

  if (value === undefined || value === null || value === '') {
    if (isRequired) {
      throw createError('inventory_count is required', 400);
    }

    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw createError('inventory_count must be an integer', 400);
  }

  return parsed;
}

function parseMetadata(body) {
  if (body.metadata === undefined) {
    return {};
  }

  if (body.metadata === null || typeof body.metadata !== 'object' || Array.isArray(body.metadata)) {
    throw createError('metadata must be an object', 400);
  }

  return body.metadata;
}

function validateBusinessRules(product) {
  const moneyFields = ['current_price', 'cost_price', 'min_price', 'max_price'];

  for (const field of moneyFields) {
    if (product[field] < 0) {
      throw createError(`${field} must be greater than or equal to 0`, 400);
    }
  }

  if (product.inventory_count !== undefined && product.inventory_count < 0) {
    throw createError('inventory_count must be greater than or equal to 0', 400);
  }

  if (product.min_price > product.max_price) {
    throw createError('min_price must be less than or equal to max_price', 400);
  }

  if (product.cost_price > product.current_price) {
    throw createError('cost_price must be less than or equal to current_price', 400);
  }

  if (product.min_price > product.current_price) {
    throw createError('min_price must be less than or equal to current_price', 400);
  }

  if (product.current_price > product.max_price) {
    throw createError('current_price must be less than or equal to max_price', 400);
  }
}

function buildCreateProduct(body) {
  const product = {
    name: parseRequiredString(body, 'name'),
    sku: parseRequiredString(body, 'sku'),
    category: parseOptionalString(body, 'category'),
    current_price: parseMoney(body, 'current_price', true),
    cost_price: parseMoney(body, 'cost_price', true),
    min_price: parseMoney(body, 'min_price', true),
    max_price: parseMoney(body, 'max_price', true),
    inventory_count: parseInventory(body, false) ?? 0,
    metadata: parseMetadata(body),
  };

  validateBusinessRules(product);
  return product;
}

function buildPatchProduct(body, existingProduct) {
  const keys = Object.keys(body);
  const invalidField = keys.find((key) => !PATCH_FIELDS.includes(key));

  if (invalidField) {
    throw createError(`${invalidField} cannot be updated`, 400);
  }

  if (keys.length === 0) {
    throw createError('At least one field is required', 400);
  }

  const changes = {};

  if (Object.hasOwn(body, 'name')) {
    changes.name = parseRequiredString(body, 'name');
  }

  if (Object.hasOwn(body, 'category')) {
    changes.category = parseOptionalString(body, 'category');
  }

  for (const field of ['current_price', 'cost_price', 'min_price', 'max_price']) {
    if (Object.hasOwn(body, field)) {
      changes[field] = parseMoney(body, field, true);
    }
  }

  if (Object.hasOwn(body, 'inventory_count')) {
    changes.inventory_count = parseInventory(body, true);
  }

  if (Object.hasOwn(body, 'is_active')) {
    if (typeof body.is_active !== 'boolean') {
      throw createError('is_active must be a boolean', 400);
    }

    changes.is_active = body.is_active;
  }

  if (Object.hasOwn(body, 'metadata')) {
    changes.metadata = parseMetadata(body);
  }

  const mergedProduct = {
    ...existingProduct,
    current_price: Number(existingProduct.current_price),
    cost_price: Number(existingProduct.cost_price),
    min_price: Number(existingProduct.min_price),
    max_price: Number(existingProduct.max_price),
    inventory_count: Number(existingProduct.inventory_count),
    ...changes,
  };

  validateBusinessRules(mergedProduct);
  return changes;
}

function getPagination(query) {
  const page = parsePositiveInteger(query.page, 1, 'page');
  const limit = Math.min(parsePositiveInteger(query.limit, 10, 'limit'), 100);

  return { page, limit };
}

export const listProducts = asyncHandler(async (req, res) => {
  const { page, limit } = getPagination(req.query);
  const category = typeof req.query.category === 'string' && req.query.category.trim()
    ? req.query.category.trim()
    : undefined;
  const isActive = parseBooleanFilter(req.query.isActive);

  const result = await listProductRecords({ page, limit, category, isActive });

  res.status(200).json(result);
});

export const getProduct = asyncHandler(async (req, res) => {
  requireUuid(req.params.id);

  const product = await getProductById(req.params.id);

  if (!product) {
    throw createError('Product not found', 404);
  }

  res.status(200).json({ product });
});

export const createProduct = asyncHandler(async (req, res) => {
  const product = buildCreateProduct(req.body || {});
  const createdProduct = await createProductRecord(product);

  res.status(201).json({ product: createdProduct });
});

export const updateProduct = asyncHandler(async (req, res) => {
  requireUuid(req.params.id);

  const existingProduct = await getProductById(req.params.id);

  if (!existingProduct) {
    throw createError('Product not found', 404);
  }

  const changes = buildPatchProduct(req.body || {}, existingProduct);
  const updatedProduct = await updateProductRecord(req.params.id, changes);

  res.status(200).json({ product: updatedProduct });
});

export const getProductHistory = asyncHandler(async (req, res) => {
  requireUuid(req.params.id);

  const product = await getProductById(req.params.id);

  if (!product) {
    throw createError('Product not found', 404);
  }

  const { page, limit } = getPagination(req.query);
  const result = await getProductHistoryRows(req.params.id, { page, limit });

  res.status(200).json(result);
});

export const getProductCompetitors = asyncHandler(async (req, res) => {
  requireUuid(req.params.id);

  const product = await getProductById(req.params.id);

  if (!product) {
    throw createError('Product not found', 404);
  }

  const items = await getProductCompetitorRows(req.params.id);

  res.status(200).json({ items });
});
