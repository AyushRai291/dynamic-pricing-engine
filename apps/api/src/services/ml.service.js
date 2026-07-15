import { ML_REQUEST_TIMEOUT_MS, ML_SERVICE_URL } from '../config/env.js';

const VALID_ACTIONS = new Set(['decrease', 'hold', 'increase']);
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

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function invalidUpstreamResponse() {
  return createError('ML service returned an invalid response', 502);
}

function unavailableMlService() {
  return createError('ML service is unavailable', 503);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildMlUrl(path) {
  return new URL(path, `${ML_SERVICE_URL}/`).toString();
}

async function requestJson(path, options, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ML_REQUEST_TIMEOUT_MS);

  try {
    let response;

    try {
      response = await fetchImpl(buildMlUrl(path), {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw unavailableMlService();
      }

      throw unavailableMlService();
    }

    if (!response || !response.ok) {
      throw invalidUpstreamResponse();
    }

    try {
      return await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw unavailableMlService();
      }

      throw invalidUpstreamResponse();
    }
  } finally {
    clearTimeout(timeout);
  }
}

function validateHealthResponse(data) {
  if (
    !isPlainObject(data)
    || data.status !== 'ok'
    || !isNonEmptyString(data.service)
    || !isNonEmptyString(data.version)
  ) {
    throw invalidUpstreamResponse();
  }

  return {
    status: data.status,
    service: data.service,
    version: data.version,
  };
}

function validatePricingScoreResponse(data) {
  if (
    !isPlainObject(data)
    || !Number.isFinite(data.price_score)
    || data.price_score < 0
    || data.price_score > 100
    || !VALID_ACTIONS.has(data.action)
    || !isNonEmptyString(data.model_version)
    || !isNonEmptyString(data.model_source)
    || !isPlainObject(data.features)
  ) {
    throw invalidUpstreamResponse();
  }

  for (const featureName of PRICE_FEATURE_NAMES) {
    if (!Number.isFinite(data.features[featureName])) {
      throw invalidUpstreamResponse();
    }
  }

  return {
    price_score: data.price_score,
    action: data.action,
    model_version: data.model_version,
    model_source: data.model_source,
    features: Object.fromEntries(
      PRICE_FEATURE_NAMES.map((name) => [name, data.features[name]])
    ),
  };
}

export async function getMlHealth({ fetchImpl = globalThis.fetch } = {}) {
  const data = await requestJson('/health', { method: 'GET' }, fetchImpl);
  return validateHealthResponse(data);
}

export async function requestPricingScore(payload, { fetchImpl = globalThis.fetch } = {}) {
  const data = await requestJson(
    '/predict',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    fetchImpl
  );

  return validatePricingScoreResponse(data);
}
