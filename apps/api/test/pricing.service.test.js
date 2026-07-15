import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const { scoreProductPricing } = await import('../src/services/pricing.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const productRow = {
  id: PRODUCT_ID,
  sku: 'SKU-1',
  name: 'Example product',
  current_price: '100.00',
  cost_price: '60.00',
  min_price: '80.00',
  max_price: '130.00',
  inventory_count: 20,
};
const mlResponse = {
  price_score: 52.5,
  action: 'hold',
  model_version: 'bootstrap-xgb-v1',
  model_source: 'synthetic_rule_based',
  features: { has_competitor_data: 1 },
};

test('pricing orchestration maps decimals and requests only the latest competitor snapshot', async () => {
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql, params });

    if (calls.length === 1) {
      return { rows: [productRow] };
    }

    return {
      rows: [
        { competitor_name: 'Amazon', price: '95.50', is_available: true },
        { competitor_name: 'Flipkart', price: '97.00', is_available: false },
      ],
    };
  };
  const requestPricingScoreFn = async (payload) => {
    assert.deepEqual(payload, {
      current_price: 100,
      cost_price: 60,
      min_price: 80,
      max_price: 130,
      inventory_count: 20,
      competitors: [
        { price: 95.5, is_available: true },
        { price: 97, is_available: false },
      ],
    });
    return mlResponse;
  };

  const result = await scoreProductPricing(PRODUCT_ID, { queryFn, requestPricingScoreFn });

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /SELECT DISTINCT ON \(competitor_name\)/);
  assert.match(calls[1].sql, /WHERE product_id = \$1/);
  assert.match(calls[1].sql, /ORDER BY competitor_name, scraped_at DESC/);
  assert.deepEqual(calls[1].params, [PRODUCT_ID]);
  assert.deepEqual(result.product, {
    id: PRODUCT_ID,
    sku: 'SKU-1',
    name: 'Example product',
    current_price: 100,
  });
  assert.equal(result.competitor_snapshot_count, 2);
  assert.equal(result.price_score, 52.5);
  assert.match(result.limitation, /synthetic bootstrap/);
  assert.equal(Object.hasOwn(result, 'suggested_price'), false);
});

test('zero competitors are sent honestly as an empty list', async () => {
  let receivedPayload;
  let queryCount = 0;
  const queryFn = async () => {
    queryCount += 1;
    return queryCount === 1 ? { rows: [productRow] } : { rows: [] };
  };
  const requestPricingScoreFn = async (payload) => {
    receivedPayload = payload;
    return {
      ...mlResponse,
      features: { has_competitor_data: 0 },
    };
  };

  const result = await scoreProductPricing(PRODUCT_ID, { queryFn, requestPricingScoreFn });

  assert.deepEqual(receivedPayload.competitors, []);
  assert.equal(result.competitor_snapshot_count, 0);
  assert.equal(result.features.has_competitor_data, 0);
});

test('missing products return 404 without calling ML', async () => {
  let mlCalled = false;
  const queryFn = async () => ({ rows: [] });
  const requestPricingScoreFn = async () => {
    mlCalled = true;
  };

  await assert.rejects(
    scoreProductPricing(PRODUCT_ID, { queryFn, requestPricingScoreFn }),
    (error) => error.statusCode === 404 && error.message === 'Product not found'
  );
  assert.equal(mlCalled, false);
});
