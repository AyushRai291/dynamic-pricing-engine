import { pool, query } from '../config/db.js';
import {
  calculateGuardedCandidate,
  calculatePercentageChange,
} from '../utils/priceSuggestion.js';
import { requestPricingScore } from './ml.service.js';

const SYNTHETIC_MODEL_LIMITATION = (
  'This is the Day 10 synthetic bootstrap 0-100 pricing score. It is not a real-world '
  + 'validated pricing outcome, confidence measure, or production pricing recommendation.'
);

const EXPERIMENTAL_SUGGESTION_LIMITATION = (
  'This experimental pending suggestion is derived from the Day 10 synthetic bootstrap '
  + '0-100 pricing score. It is not a real-world validated optimal price, revenue-uplift '
  + 'estimate, confidence measure, or production pricing recommendation.'
);

const SUGGESTION_SELECT_COLUMNS = `
  ps.id,
  ps.product_id,
  p.name AS product_name,
  p.sku,
  ps.current_price,
  ps.suggested_price,
  ps.price_score,
  ps.status,
  ps.feature_vector,
  ps.created_at
`;

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
    product.cost_price > product.current_price
    || product.min_price > product.current_price
    || product.current_price > product.max_price
    || product.cost_price > product.max_price
  ) {
    throw new Error('Stored product pricing is incompatible with ML scoring');
  }

  return product;
}

function buildMlPayload(product, competitors) {
  return {
    current_price: product.current_price,
    cost_price: product.cost_price,
    min_price: Math.max(product.min_price, product.cost_price),
    max_price: product.max_price,
    inventory_count: product.inventory_count,
    competitors,
  };
}

function summarizeCompetitors(competitors) {
  const availablePricesInCents = competitors
    .filter((competitor) => competitor.is_available)
    .map((competitor) => Math.round(competitor.price * 100));
  const averagePrice = availablePricesInCents.length > 0
    ? Math.round(
      availablePricesInCents.reduce((total, price) => total + price, 0)
      / availablePricesInCents.length
    ) / 100
    : null;

  return {
    count: competitors.length,
    available_count: availablePricesInCents.length,
    average_price: averagePrice,
  };
}

function mapSuggestion(row, product = null) {
  const metadata = row.feature_vector && typeof row.feature_vector === 'object'
    ? row.feature_vector
    : {};
  const currentPrice = parseFiniteNumber(row.current_price, 'suggestion current_price', {
    minimum: Number.MIN_VALUE,
  });
  const suggestedPrice = parseFiniteNumber(row.suggested_price, 'suggested_price');
  const storedPriceScore = row.price_score === null
    ? null
    : parseFiniteNumber(row.price_score, 'price_score');
  const priceScore = metadata.price_score === undefined
    ? storedPriceScore
    : parseFiniteNumber(metadata.price_score, 'feature_vector price_score');
  const competitorSnapshot = metadata.competitor_snapshot || {
    count: 0,
    available_count: 0,
    average_price: null,
  };

  return {
    id: row.id,
    status: row.status,
    product: {
      id: product?.id || row.product_id,
      name: product?.name || row.product_name,
      sku: product?.sku || row.sku,
    },
    current_price: currentPrice,
    suggested_price: suggestedPrice,
    percentage_change: calculatePercentageChange(currentPrice, suggestedPrice),
    price_score: priceScore,
    action: metadata.action || null,
    model_version: metadata.model_version || null,
    model_source: metadata.model_source || null,
    competitor_snapshot: competitorSnapshot,
    raw_candidate: metadata.raw_candidate ?? suggestedPrice,
    applied_guardrails: Array.isArray(metadata.applied_guardrails)
      ? metadata.applied_guardrails
      : [],
    created_at: row.created_at,
    limitation: metadata.limitation || EXPERIMENTAL_SUGGESTION_LIMITATION,
  };
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

async function loadActiveProductPricingForUpdate(productId, queryFn) {
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
     WHERE id = $1
       AND is_active = TRUE
     FOR UPDATE`,
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
  const mlPayload = buildMlPayload(product, competitors);
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

export async function createPendingPriceSuggestion(
  productId,
  {
    poolInstance = pool,
    requestPricingScoreFn = requestPricingScore,
  } = {}
) {
  const client = await poolInstance.connect();

  try {
    await client.query('BEGIN');

    const productRow = await loadActiveProductPricingForUpdate(productId, client.query.bind(client));

    if (!productRow) {
      throw createError('Active product not found', 404);
    }

    const pendingResult = await client.query(
      `SELECT id
       FROM price_suggestions
       WHERE product_id = $1
         AND status = 'pending'
       LIMIT 1`,
      [productId]
    );

    if (pendingResult.rows[0]) {
      throw createError('A pending price suggestion already exists for this product', 409);
    }

    const product = mapProductPricing(productRow);
    const competitorRows = await loadLatestCompetitorSnapshot(
      productId,
      client.query.bind(client)
    );
    const competitors = mapCompetitorSnapshot(competitorRows);
    const score = await requestPricingScoreFn(buildMlPayload(product, competitors));
    const candidate = calculateGuardedCandidate({
      currentPrice: product.current_price,
      costPrice: product.cost_price,
      minPrice: product.min_price,
      maxPrice: product.max_price,
      score: score.price_score,
      action: score.action,
    });
    const featureVector = {
      price_score: score.price_score,
      action: score.action,
      model_version: score.model_version,
      model_source: score.model_source,
      features: score.features,
      competitor_snapshot: summarizeCompetitors(competitors),
      raw_candidate: candidate.rawCandidate,
      final_guarded_candidate: candidate.finalCandidate,
      applied_guardrails: candidate.appliedGuardrails,
      limitation: EXPERIMENTAL_SUGGESTION_LIMITATION,
    };
    const insertResult = await client.query(
      `INSERT INTO price_suggestions (
         product_id,
         current_price,
         suggested_price,
         price_score,
         status,
         feature_vector
       )
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb)
       RETURNING
         id,
         product_id,
         current_price,
         suggested_price,
         price_score,
         status,
         feature_vector,
         created_at`,
      [
        productId,
        product.current_price,
        candidate.finalCandidate,
        score.price_score,
        featureVector,
      ]
    );

    const suggestion = mapSuggestion(insertResult.rows[0], product);

    await client.query('COMMIT');
    return suggestion;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original sanitized workflow error.
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function listPriceSuggestions(
  { status, limit },
  { queryFn = query } = {}
) {
  const result = await queryFn(
    `SELECT ${SUGGESTION_SELECT_COLUMNS}
     FROM price_suggestions ps
     JOIN products p ON p.id = ps.product_id
     WHERE ps.status = $1
     ORDER BY ps.created_at DESC, ps.id DESC
     LIMIT $2`,
    [status, limit]
  );

  return {
    items: result.rows.map((row) => mapSuggestion(row)),
    limit,
  };
}

export async function getPriceSuggestionById(id, { queryFn = query } = {}) {
  const result = await queryFn(
    `SELECT ${SUGGESTION_SELECT_COLUMNS}
     FROM price_suggestions ps
     JOIN products p ON p.id = ps.product_id
     WHERE ps.id = $1`,
    [id]
  );

  if (!result.rows[0]) {
    throw createError('Price suggestion not found', 404);
  }

  return mapSuggestion(result.rows[0]);
}
