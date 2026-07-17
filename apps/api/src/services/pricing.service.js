import { pool, query } from '../config/db.js';
import { PRICE_SUGGESTION_TTL_HOURS } from '../config/env.js';
import {
  calculateGuardedCandidate,
  calculatePercentageChange,
} from '../utils/priceSuggestion.js';
import {
  PRICING_RATIONALE_LIMITATION,
  generateGeminiPricingRationale,
} from './geminiRationale.service.js';
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
  ps.approved_by,
  ps.approved_at,
  ps.expires_at,
  ps.feature_vector,
  ps.ai_rationale,
  ps.created_at
`;

const PRICE_FEATURE_NAMES = [
  'price_gap_ratio',
  'gross_margin_ratio',
  'markdown_headroom_ratio',
  'markup_headroom_ratio',
  'price_position_ratio',
  'inventory_count',
  'competitor_count',
  'available_competitor_count',
  'competitor_available_ratio',
  'competitor_price_spread_ratio',
  'has_competitor_data',
];
const VALID_ACTIONS = new Set(['decrease', 'hold', 'increase']);
const VALID_GUARDRAILS = new Set(['min_price', 'max_price', 'cost_price']);
const EXPIRED_DECISION = Symbol('expired-decision');

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStoredRationale(value) {
  if (value === null || value === undefined) {
    return null;
  }

  let rationale = value;

  if (typeof value === 'string') {
    try {
      rationale = JSON.parse(value);
    } catch {
      throw new Error('Invalid AI rationale in stored pricing data');
    }
  }

  if (!isPlainObject(rationale)) {
    throw new Error('Invalid AI rationale in stored pricing data');
  }

  return {
    ...rationale,
    limitation: PRICING_RATIONALE_LIMITATION,
  };
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

function getSuggestionExpiresAt(row) {
  if (row.expires_at !== null && row.expires_at !== undefined) {
    return row.expires_at;
  }

  if (!['pending', 'expired'].includes(row.status)) return null;

  const createdAt = new Date(row.created_at);

  if (!Number.isFinite(createdAt.getTime())) {
    throw new Error('Invalid suggestion created_at in stored pricing data');
  }

  return new Date(
    createdAt.getTime() + PRICE_SUGGESTION_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();
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

  const suggestion = {
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
    aiRationale: parseStoredRationale(row.ai_rationale),
  };

  for (const field of ['approved_by', 'approved_at', 'expires_at']) {
    if (Object.hasOwn(row, field)) {
      suggestion[field] = row[field];
    }
  }

  if (Object.hasOwn(row, 'expires_at')) {
    suggestion.expiresAt = getSuggestionExpiresAt(row);
  }

  return suggestion;
}

async function expireDuePriceSuggestions(queryFn, { id, productId } = {}) {
  const params = [PRICE_SUGGESTION_TTL_HOURS];
  const filters = [
    "status = 'pending'",
    `COALESCE(expires_at, created_at + ($1::int * INTERVAL '1 hour')) <= clock_timestamp()`,
  ];

  if (id !== undefined) {
    params.push(id);
    filters.push(`id = $${params.length}`);
  }

  if (productId !== undefined) {
    params.push(productId);
    filters.push(`product_id = $${params.length}`);
  }

  const result = await queryFn(
    `UPDATE price_suggestions
     SET status = 'expired',
         expires_at = COALESCE(
           expires_at,
           created_at + ($1::int * INTERVAL '1 hour')
         )
     WHERE ${filters.join('\n       AND ')}
     RETURNING id, status`,
    params
  );

  return result.rows.some((row) => row.status === 'expired');
}

function moneyToCents(value, fieldName) {
  return Math.round(parseFiniteNumber(value, fieldName) * 100);
}

function assertPendingSuggestion(row) {
  if (row.status !== 'pending') {
    throw createError('Price suggestion is no longer pending', 409);
  }
}

function assertSuggestionCanBeApproved(suggestion, product) {
  const savedCurrentPrice = moneyToCents(
    suggestion.current_price,
    'suggestion current_price'
  );
  const currentPrice = moneyToCents(product.current_price, 'product current_price');

  if (currentPrice !== savedCurrentPrice) {
    throw createError('Product price changed after this suggestion was created', 409);
  }

  const suggestedPrice = moneyToCents(suggestion.suggested_price, 'suggested_price');
  const costPrice = moneyToCents(product.cost_price, 'cost_price');
  const minPrice = moneyToCents(product.min_price, 'min_price');
  const maxPrice = moneyToCents(product.max_price, 'max_price');

  if (suggestedPrice < costPrice || suggestedPrice < minPrice || suggestedPrice > maxPrice) {
    throw createError('Suggested price no longer passes product price guardrails', 409);
  }
}

function mapPriceHistory(row) {
  return {
    id: row.id,
    product_id: row.product_id,
    old_price: parseFiniteNumber(row.old_price, 'price history old_price'),
    new_price: parseFiniteNumber(row.new_price, 'price history new_price'),
    change_reason: row.change_reason,
    suggestion_id: row.suggestion_id,
    changed_by: row.changed_by,
    created_at: row.created_at,
  };
}

async function runDecisionTransaction(poolInstance, callback) {
  const client = await poolInstance.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
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

async function loadSuggestionForUpdate(id, queryFn) {
  const result = await queryFn(
    `SELECT ${SUGGESTION_SELECT_COLUMNS}
     FROM price_suggestions ps
     LEFT JOIN products p ON p.id = ps.product_id
     WHERE ps.id = $1
     FOR UPDATE OF ps`,
    [id]
  );

  return result.rows[0] || null;
}

function buildRationaleFacts(row) {
  const suggestion = mapSuggestion(row);
  const metadata = isPlainObject(row.feature_vector) ? row.feature_vector : {};
  const action = metadata.action;
  const modelVersion = metadata.model_version;
  const modelSource = metadata.model_source;

  if (!VALID_ACTIONS.has(action)) {
    throw new Error('Invalid action in stored pricing data');
  }

  if (typeof modelVersion !== 'string' || !modelVersion.trim()) {
    throw new Error('Invalid model_version in stored pricing data');
  }

  if (typeof modelSource !== 'string' || !modelSource.trim()) {
    throw new Error('Invalid model_source in stored pricing data');
  }

  if (typeof row.product_name !== 'string' || !row.product_name.trim()) {
    throw new Error('Invalid product name in stored pricing data');
  }

  if (typeof row.sku !== 'string' || !row.sku.trim()) {
    throw new Error('Invalid product SKU in stored pricing data');
  }

  const featureVector = {};
  const storedFeatures = isPlainObject(metadata.features) ? metadata.features : {};

  for (const name of PRICE_FEATURE_NAMES) {
    if (storedFeatures[name] !== undefined) {
      featureVector[name] = parseFiniteNumber(
        storedFeatures[name],
        `feature_vector features.${name}`,
        { minimum: Number.NEGATIVE_INFINITY }
      );
    }
  }

  const competitorSnapshot = isPlainObject(metadata.competitor_snapshot)
    ? metadata.competitor_snapshot
    : {};
  const competitorCount = parseFiniteNumber(
    competitorSnapshot.count ?? 0,
    'competitor_snapshot count',
    { integer: true }
  );
  const availableCompetitorCount = parseFiniteNumber(
    competitorSnapshot.available_count ?? 0,
    'competitor_snapshot available_count',
    { integer: true }
  );

  if (availableCompetitorCount > competitorCount) {
    throw new Error('Invalid competitor snapshot in stored pricing data');
  }

  const averagePrice = competitorSnapshot.average_price === null
    || competitorSnapshot.average_price === undefined
    ? null
    : parseFiniteNumber(
      competitorSnapshot.average_price,
      'competitor_snapshot average_price',
      { minimum: Number.MIN_VALUE }
    );
  const appliedGuardrails = suggestion.applied_guardrails;

  if (
    !appliedGuardrails.every(
      (guardrail) => typeof guardrail === 'string' && VALID_GUARDRAILS.has(guardrail)
    )
  ) {
    throw new Error('Invalid applied guardrails in stored pricing data');
  }

  return {
    product: {
      name: row.product_name,
      sku: row.sku,
    },
    currentPrice: suggestion.current_price,
    suggestedPrice: suggestion.suggested_price,
    percentageChange: suggestion.percentage_change,
    priceScore: parseFiniteNumber(suggestion.price_score, 'suggestion price_score'),
    action,
    modelVersion: modelVersion.trim(),
    modelSource: modelSource.trim(),
    featureVector,
    competitorSnapshot: {
      count: competitorCount,
      availableCount: availableCompetitorCount,
      averagePrice,
    },
    rawCandidate: parseFiniteNumber(metadata.raw_candidate, 'raw_candidate'),
    appliedGuardrails: [...appliedGuardrails],
    existingLimitation: suggestion.limitation,
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

async function loadProductPricingForUpdate(productId, queryFn) {
  const result = await queryFn(
    `SELECT
       id,
       sku,
       name,
       current_price,
       cost_price,
       min_price,
       max_price,
       inventory_count,
       is_active
     FROM products
     WHERE id = $1
     FOR UPDATE`,
    [productId]
  );

  return result.rows[0] || null;
}

async function loadLatestCompetitorSnapshot(productId, queryFn) {
  const result = await queryFn(
    `SELECT DISTINCT ON (ct.id)
       cd.competitor_name,
       cd.price,
       cd.is_available,
       cd.scraped_at
     FROM competitor_targets ct
     JOIN competitor_data cd
       ON cd.product_id = ct.product_id
      AND cd.competitor_name = ct.competitor_name
      AND cd.competitor_url = ct.competitor_url
     WHERE ct.product_id = $1
       AND ct.is_active = TRUE
     ORDER BY ct.id, cd.scraped_at DESC, cd.created_at DESC, cd.id DESC`,
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

    await expireDuePriceSuggestions(client.query.bind(client), { productId });

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
         feature_vector,
         expires_at
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         'pending',
         $5::jsonb,
         clock_timestamp() + ($6::int * INTERVAL '1 hour')
       )
       RETURNING
         id,
         product_id,
         current_price,
         suggested_price,
         price_score,
         status,
         expires_at,
         feature_vector,
         ai_rationale,
         created_at`,
      [
        productId,
        product.current_price,
        candidate.finalCandidate,
        score.price_score,
        featureVector,
        PRICE_SUGGESTION_TTL_HOURS,
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

export async function approvePriceSuggestion(
  id,
  reviewerId,
  { poolInstance = pool } = {}
) {
  const result = await runDecisionTransaction(poolInstance, async (client) => {
    const queryFn = client.query.bind(client);
    const lockedSuggestion = await loadSuggestionForUpdate(id, queryFn);

    if (!lockedSuggestion) {
      throw createError('Price suggestion not found', 404);
    }

    if (await expireDuePriceSuggestions(queryFn, { id })) {
      return EXPIRED_DECISION;
    }

    assertPendingSuggestion(lockedSuggestion);

    const productRow = await loadProductPricingForUpdate(
      lockedSuggestion.product_id,
      queryFn
    );

    if (!productRow) {
      throw createError('Product not found', 404);
    }

    if (!productRow.is_active) {
      throw createError('Product is no longer active', 409);
    }

    assertSuggestionCanBeApproved(lockedSuggestion, productRow);

    const oldPrice = parseFiniteNumber(productRow.current_price, 'product current_price');
    const newPrice = parseFiniteNumber(lockedSuggestion.suggested_price, 'suggested_price');

    const suggestionResult = await client.query(
      `UPDATE price_suggestions
       SET status = 'approved',
           approved_by = $2,
           approved_at = NOW()
       WHERE id = $1
         AND status = 'pending'
         AND COALESCE(
           expires_at,
           created_at + ($3::int * INTERVAL '1 hour')
         ) > clock_timestamp()
       RETURNING
         id,
         product_id,
         current_price,
         suggested_price,
         price_score,
         status,
         approved_by,
         approved_at,
         expires_at,
         feature_vector,
         ai_rationale,
         created_at`,
      [id, reviewerId, PRICE_SUGGESTION_TTL_HOURS]
    );

    if (!suggestionResult.rows[0]) {
      if (await expireDuePriceSuggestions(queryFn, { id })) {
        return EXPIRED_DECISION;
      }

      throw createError('Price suggestion is no longer pending', 409);
    }

    await client.query(
      `UPDATE products
       SET current_price = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [productRow.id, lockedSuggestion.suggested_price]
    );

    const historyResult = await client.query(
      `INSERT INTO price_history (
         product_id,
         old_price,
         new_price,
         change_reason,
         suggestion_id,
         changed_by
       )
       VALUES ($1, $2, $3, 'suggestion_approved', $4, $5)
       RETURNING
         id,
         product_id,
         old_price,
         new_price,
         change_reason,
         suggestion_id,
         changed_by,
         created_at`,
      [productRow.id, productRow.current_price, lockedSuggestion.suggested_price, id, reviewerId]
    );

    const suggestion = mapSuggestion(
      { ...lockedSuggestion, ...suggestionResult.rows[0] },
      productRow
    );

    return {
      suggestion,
      old_price: oldPrice,
      new_price: newPrice,
      price_history: mapPriceHistory(historyResult.rows[0]),
    };
  });

  if (result === EXPIRED_DECISION) {
    throw createError('Price suggestion has expired', 409);
  }

  return result;
}

export async function rejectPriceSuggestion(
  id,
  { poolInstance = pool } = {}
) {
  const result = await runDecisionTransaction(poolInstance, async (client) => {
    const queryFn = client.query.bind(client);
    const lockedSuggestion = await loadSuggestionForUpdate(id, queryFn);

    if (!lockedSuggestion) {
      throw createError('Price suggestion not found', 404);
    }

    if (await expireDuePriceSuggestions(queryFn, { id })) {
      return EXPIRED_DECISION;
    }

    assertPendingSuggestion(lockedSuggestion);

    const suggestionResult = await client.query(
      `UPDATE price_suggestions
       SET status = 'rejected'
       WHERE id = $1
         AND status = 'pending'
         AND COALESCE(
           expires_at,
           created_at + ($2::int * INTERVAL '1 hour')
         ) > clock_timestamp()
       RETURNING
         id,
         product_id,
         current_price,
         suggested_price,
         price_score,
         status,
         approved_by,
         approved_at,
         expires_at,
         feature_vector,
         ai_rationale,
         created_at`,
      [id, PRICE_SUGGESTION_TTL_HOURS]
    );

    if (!suggestionResult.rows[0]) {
      if (await expireDuePriceSuggestions(queryFn, { id })) {
        return EXPIRED_DECISION;
      }

      throw createError('Price suggestion is no longer pending', 409);
    }

    return mapSuggestion({ ...lockedSuggestion, ...suggestionResult.rows[0] });
  });

  if (result === EXPIRED_DECISION) {
    throw createError('Price suggestion has expired', 409);
  }

  return result;
}

export async function listPriceSuggestions(
  { status, limit },
  { queryFn = query } = {}
) {
  await expireDuePriceSuggestions(queryFn);

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

export async function listGlobalPriceHistory(
  { productId, from, to, page, limit },
  { queryFn = query } = {}
) {
  const where = [];
  const params = [];

  if (productId !== undefined) {
    params.push(productId);
    where.push(`ph.product_id = $${params.length}`);
  }
  if (from !== undefined) {
    params.push(from);
    where.push(`ph.created_at >= $${params.length}::date`);
  }
  if (to !== undefined) {
    params.push(to);
    where.push(`ph.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await queryFn(
    `SELECT COUNT(*)::int AS total
     FROM price_history ph
     ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total) || 0;
  const offset = (page - 1) * limit;
  const itemParams = [...params, limit, offset];
  const result = await queryFn(
    `SELECT
       ph.id,
       ph.product_id AS "productId",
       p.name AS "productName",
       p.sku AS "productSku",
       ph.old_price::text AS "oldPrice",
       ph.new_price::text AS "newPrice",
       CASE
         WHEN ph.old_price = 0 THEN NULL
         ELSE ROUND(((ph.new_price - ph.old_price) / ph.old_price) * 100, 2)::text
       END AS "percentageChange",
       CASE
         WHEN ph.suggestion_id IS NOT NULL THEN 'price_suggestion'
         ELSE 'price_history'
       END AS source,
       ph.change_reason AS "changeReason",
       ph.suggestion_id AS "suggestionId",
       ph.created_at AS "changedAt"
     FROM price_history ph
     JOIN products p ON p.id = ph.product_id
     ${whereSql}
     ORDER BY ph.created_at DESC, ph.id DESC
     LIMIT $${itemParams.length - 1}
     OFFSET $${itemParams.length}`,
    itemParams
  );

  return {
    items: result.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getPriceSuggestionById(id, { queryFn = query } = {}) {
  await expireDuePriceSuggestions(queryFn, { id });

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

export async function generatePriceSuggestionRationale(
  id,
  {
    queryFn = query,
    generateRationaleFn = generateGeminiPricingRationale,
  } = {}
) {
  if (await expireDuePriceSuggestions(queryFn, { id })) {
    throw createError('Price suggestion has expired', 409);
  }

  const snapshotResult = await queryFn(
    `SELECT ${SUGGESTION_SELECT_COLUMNS}
     FROM price_suggestions ps
     JOIN products p ON p.id = ps.product_id
     WHERE ps.id = $1`,
    [id]
  );
  const row = snapshotResult.rows[0];

  if (!row) {
    throw createError('Price suggestion not found', 404);
  }

  if (row.status !== 'pending') {
    throw createError('Price suggestion is no longer pending', 409);
  }

  const existingRationale = parseStoredRationale(row.ai_rationale);

  if (existingRationale) {
    if (await expireDuePriceSuggestions(queryFn, { id })) {
      throw createError('Price suggestion has expired', 409);
    }

    return {
      generated: false,
      suggestionId: id,
      rationale: existingRationale,
    };
  }

  const rationale = await generateRationaleFn(buildRationaleFacts(row));
  const serializedRationale = JSON.stringify(rationale);
  const updateResult = await queryFn(
    `UPDATE price_suggestions
     SET ai_rationale = $2
     WHERE id = $1
       AND status = 'pending'
       AND ai_rationale IS NULL
       AND COALESCE(
         expires_at,
         created_at + ($3::int * INTERVAL '1 hour')
       ) > clock_timestamp()
     RETURNING ai_rationale`,
    [id, serializedRationale, PRICE_SUGGESTION_TTL_HOURS]
  );

  if (updateResult.rows[0]) {
    return {
      generated: true,
      suggestionId: id,
      rationale: parseStoredRationale(
        updateResult.rows[0].ai_rationale ?? serializedRationale
      ),
    };
  }

  if (await expireDuePriceSuggestions(queryFn, { id })) {
    throw createError('Price suggestion has expired', 409);
  }

  const currentResult = await queryFn(
    `SELECT status, ai_rationale
     FROM price_suggestions
     WHERE id = $1`,
    [id]
  );
  const current = currentResult.rows[0];

  if (!current) {
    throw createError('Price suggestion not found', 404);
  }

  if (current.status !== 'pending') {
    throw createError('Price suggestion is no longer pending', 409);
  }

  const concurrentRationale = parseStoredRationale(current.ai_rationale);

  if (concurrentRationale) {
    return {
      generated: false,
      suggestionId: id,
      rationale: concurrentRationale,
    };
  }

  throw createError('Price suggestion rationale could not be saved', 409);
}
