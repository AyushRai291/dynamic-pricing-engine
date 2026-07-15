import {
  bulkUpsertDailySales,
  fetchProductSalesHistory,
} from '../services/sales.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECORDS = 366;
const DEFAULT_LIMIT = 90;
const ALLOWED_RECORD_FIELDS = new Set(['saleDate', 'unitsSold', 'sellingPrice']);

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function currentIsoDate() {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value, fieldName, today) {
  if (typeof value !== 'string' || !ISO_DATE_REGEX.test(value)) {
    throw createError(`${fieldName} must use YYYY-MM-DD`, 400);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (
    value.startsWith('0000-')
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw createError(`${fieldName} must be a valid date`, 400);
  }

  if (value > today) {
    throw createError(`${fieldName} cannot be in the future`, 400);
  }

  return value;
}

export function validateProductId(productId) {
  if (!UUID_REGEX.test(productId)) {
    throw createError('Invalid product id', 400);
  }

  return productId;
}

export function parseBulkSalesBody(body, { today = currentIsoDate() } = {}) {
  if (!isPlainObject(body) || Object.keys(body).length !== 1 || !Array.isArray(body.records)) {
    throw createError('Body must contain only a records array', 400);
  }

  if (body.records.length < 1 || body.records.length > MAX_RECORDS) {
    throw createError(`records must contain between 1 and ${MAX_RECORDS} items`, 400);
  }

  const seenDates = new Set();
  const records = body.records.map((record, index) => {
    if (!isPlainObject(record)) {
      throw createError(`records[${index}] must be an object`, 400);
    }

    const fields = Object.keys(record);

    if (
      fields.length !== ALLOWED_RECORD_FIELDS.size
      || fields.some((field) => !ALLOWED_RECORD_FIELDS.has(field))
    ) {
      throw createError(
        `records[${index}] must contain only saleDate, unitsSold, and sellingPrice`,
        400
      );
    }

    const saleDate = parseIsoDate(record.saleDate, `records[${index}].saleDate`, today);

    if (seenDates.has(saleDate)) {
      throw createError(`Duplicate saleDate: ${saleDate}`, 400);
    }

    if (!Number.isInteger(record.unitsSold) || record.unitsSold < 0) {
      throw createError(`records[${index}].unitsSold must be a non-negative integer`, 400);
    }

    if (!Number.isFinite(record.sellingPrice) || record.sellingPrice <= 0) {
      throw createError(`records[${index}].sellingPrice must be a positive number`, 400);
    }

    seenDates.add(saleDate);
    return {
      saleDate,
      unitsSold: record.unitsSold,
      sellingPrice: record.sellingPrice,
    };
  });

  return records;
}

export function parseSalesHistoryQuery(query, { today = currentIsoDate() } = {}) {
  const from = query.from === undefined ? undefined : parseIsoDate(query.from, 'from', today);
  const to = query.to === undefined ? undefined : parseIsoDate(query.to, 'to', today);

  if (from !== undefined && to !== undefined && from > to) {
    throw createError('from must be before or equal to to', 400);
  }

  let limit = DEFAULT_LIMIT;

  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)) {
      throw createError(`limit must be an integer between 1 and ${MAX_RECORDS}`, 400);
    }

    limit = Number(query.limit);

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORDS) {
      throw createError(`limit must be an integer between 1 and ${MAX_RECORDS}`, 400);
    }
  }

  return { from, to, limit };
}

export function createBulkProductSalesHandler({ bulkUpsertFn = bulkUpsertDailySales } = {}) {
  return asyncHandler(async (req, res) => {
    const productId = validateProductId(req.params.id);
    const records = parseBulkSalesBody(req.body);
    const result = await bulkUpsertFn(productId, records);

    res.status(200).json(result);
  });
}

export function createGetProductSalesHandler({ fetchHistoryFn = fetchProductSalesHistory } = {}) {
  return asyncHandler(async (req, res) => {
    const productId = validateProductId(req.params.id);
    const filters = parseSalesHistoryQuery(req.query);
    const result = await fetchHistoryFn(productId, filters);

    res.status(200).json(result);
  });
}

export const bulkUpsertProductSales = createBulkProductSalesHandler();
export const getProductSales = createGetProductSalesHandler();
