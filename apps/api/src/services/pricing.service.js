import { query } from '../config/db.js';
import { requestPricingScore } from './ml.service.js';

const SYNTHETIC_MODEL_LIMITATION = (
  'This is the Day 10 synthetic bootstrap 0-100 pricing score. '
  + 'It is not a suggested price or real-world validated pricing outcome.'
);

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseFiniteNumber(value, fieldName, { minimum = 0, integer = false } = {}) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < minimum || (integer && !Number.isInteger(parsed))) {
    throw new Error(`Invalid ${fieldName} in stored pricing data`);
  }

  return parsed;
}

function mapProductPricing(row) {
  const product = {
    id: row.id,
    sku: row.sku,
    name: row.name,
    current_price: parseFiniteNumber(row.current_price, 'current_price', { minimum: Number.MIN_VALUE }),
    cost_price: parseFiniteNumber(row.cost_price, 'cost_price'),
    min_price: parseFiniteNumber(row.min_price, 'min_price', { minimum: Number.MIN_VALUE }),
    max_price: parseFiniteNumber(row.max_price, 'max_price', { minimum: Number.MIN_VALUE }),
    inventory_count: parseFiniteNumber(row.inventory_count, 'inventory_count', { integer: true }),
  };

  if (
    product.cost_price > product.min_price
    || product.min_price > product.current_price
    || product.current_price > product.max_price
  ) {
    throw new Error('Stored product pricing is incompatible with ML scoring');
  }

  return product;
}

function mapCompetitorSnapshot(rows) {
  return rows.map((row) => {
    if (typeof row.is_available !== 'boolean') {
      throw new Error('Invalid competitor availability in stored pricing data');
    }

    return {
      price: parseFiniteNumber(row.price, 'competitor price', { minimum: Number.MIN_VALUE }),
      is_available: row.is_available,
    };
  });
}

async function loadProductPricing(productId, queryFn) {
  const result = await queryFn(
    `SELECT
       id,
       sku,
       name,
       current_price,
       cost_price,
       min_price,
       max_price,
       inventory_count
     FROM products
     WHERE id = $1`,
    [productId]
  );

  return result.rows[0] || null;
}

async function loadLatestCompetitorSnapshot(productId, queryFn) {
  const result = await queryFn(
    `SELECT DISTINCT ON (competitor_name)
       competitor_name,
       price,
       is_available,
       scraped_at
     FROM competitor_data
     WHERE product_id = $1
     ORDER BY competitor_name, scraped_at DESC, created_at DESC, id DESC`,
    [productId]
  );

  return result.rows;
}

export async function scoreProductPricing(
  productId,
  {
    queryFn = query,
    requestPricingScoreFn = requestPricingScore,
  } = {}
) {
  const productRow = await loadProductPricing(productId, queryFn);

  if (!productRow) {
    throw createError('Product not found', 404);
  }

  const product = mapProductPricing(productRow);
  const competitorRows = await loadLatestCompetitorSnapshot(productId, queryFn);
  const competitors = mapCompetitorSnapshot(competitorRows);
  const mlPayload = {
    current_price: product.current_price,
    cost_price: product.cost_price,
    min_price: product.min_price,
    max_price: product.max_price,
    inventory_count: product.inventory_count,
    competitors,
  };
  const score = await requestPricingScoreFn(mlPayload);

  return {
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      current_price: product.current_price,
    },
    competitor_snapshot_count: competitors.length,
    price_score: score.price_score,
    action: score.action,
    model_version: score.model_version,
    model_source: score.model_source,
    features: score.features,
    limitation: SYNTHETIC_MODEL_LIMITATION,
  };
}
