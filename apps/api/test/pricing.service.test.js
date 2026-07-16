import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createPendingPriceSuggestion,
  getPriceSuggestionById,
  listPriceSuggestions,
  scoreProductPricing,
} = await import('../src/services/pricing.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
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

function createMockPool(queryHandler) {
  let released = false;
  const client = {
    query: queryHandler,
    release() {
      released = true;
    },
  };

  return {
    pool: {
      async connect() {
        return client;
      },
    },
    wasReleased: () => released,
  };
}

test('pending suggestion creation scores latest competitors and inserts schema-compatible JSON', async () => {
  const calls = [];
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });

    if (/FROM products/.test(sql)) {
      return { rows: [productRow] };
    }

    if (/SELECT id\s+FROM price_suggestions/.test(sql)) {
      return { rows: [] };
    }

    if (/SELECT DISTINCT ON/.test(sql)) {
      return {
        rows: [
          { competitor_name: 'Amazon', price: '95.50', is_available: true },
          { competitor_name: 'Flipkart', price: '97.00', is_available: false },
        ],
      };
    }

    if (/INSERT INTO price_suggestions/.test(sql)) {
      return {
        rows: [{
          id: SUGGESTION_ID,
          product_id: PRODUCT_ID,
          current_price: '100.00',
          suggested_price: '105.00',
          price_score: '80.00',
          status: 'pending',
          feature_vector: params[4],
          created_at: '2026-07-17T05:00:00.000Z',
        }],
      };
    }

    return { rows: [] };
  });
  let receivedPayload;
  const requestPricingScoreFn = async (payload) => {
    receivedPayload = payload;
    return {
      ...mlResponse,
      price_score: 80,
      action: 'increase',
    };
  };

  const suggestion = await createPendingPriceSuggestion(PRODUCT_ID, {
    poolInstance: pool,
    requestPricingScoreFn,
  });

  assert.deepEqual(receivedPayload.competitors, [
    { price: 95.5, is_available: true },
    { price: 97, is_available: false },
  ]);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /is_active = TRUE/);
  assert.match(calls[1].sql, /FOR UPDATE/);
  assert.deepEqual(calls[1].params, [PRODUCT_ID]);
  assert.match(calls[2].sql, /status = 'pending'/);
  assert.deepEqual(calls[2].params, [PRODUCT_ID]);

  const insert = calls.find(({ sql }) => /INSERT INTO price_suggestions/.test(sql));
  assert.ok(insert);
  assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, \$4, 'pending', \$5::jsonb\)/);
  assert.doesNotMatch(insert.sql, new RegExp(PRODUCT_ID));
  assert.deepEqual(insert.params.slice(0, 4), [PRODUCT_ID, 100, 105, 80]);
  assert.deepEqual(insert.params[4].competitor_snapshot, {
    count: 2,
    available_count: 1,
    average_price: 95.5,
  });
  assert.equal(insert.params[4].price_score, 80);
  assert.equal(insert.params[4].action, 'increase');
  assert.equal(insert.params[4].raw_candidate, 105);
  assert.equal(insert.params[4].final_guarded_candidate, 105);
  assert.deepEqual(insert.params[4].applied_guardrails, []);
  assert.match(insert.params[4].limitation, /synthetic bootstrap/);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(wasReleased(), true);

  const mutatingSql = calls
    .map(({ sql }) => sql)
    .filter((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
  assert.equal(mutatingSql.length, 1);
  assert.match(mutatingSql[0], /INSERT INTO price_suggestions/);
  assert.doesNotMatch(mutatingSql[0], /UPDATE\s+products|price_history/i);
  assert.deepEqual(suggestion, {
    id: SUGGESTION_ID,
    status: 'pending',
    product: {
      id: PRODUCT_ID,
      name: 'Example product',
      sku: 'SKU-1',
    },
    current_price: 100,
    suggested_price: 105,
    percentage_change: 5,
    price_score: 80,
    action: 'increase',
    model_version: 'bootstrap-xgb-v1',
    model_source: 'synthetic_rule_based',
    competitor_snapshot: {
      count: 2,
      available_count: 1,
      average_price: 95.5,
    },
    raw_candidate: 105,
    applied_guardrails: [],
    created_at: '2026-07-17T05:00:00.000Z',
    limitation: insert.params[4].limitation,
  });
});

test('creation records an honest empty competitor summary', async () => {
  const { pool } = createMockPool(async (sql, params) => {
    if (/FROM products/.test(sql)) {
      return { rows: [productRow] };
    }

    if (/SELECT DISTINCT ON/.test(sql) || /SELECT id\s+FROM price_suggestions/.test(sql)) {
      return { rows: [] };
    }

    if (/INSERT INTO price_suggestions/.test(sql)) {
      return {
        rows: [{
          id: SUGGESTION_ID,
          product_id: PRODUCT_ID,
          current_price: '100.00',
          suggested_price: '100.00',
          price_score: '52.50',
          status: 'pending',
          feature_vector: params[4],
          created_at: '2026-07-17T05:00:00.000Z',
        }],
      };
    }

    return { rows: [] };
  });

  const suggestion = await createPendingPriceSuggestion(PRODUCT_ID, {
    poolInstance: pool,
    requestPricingScoreFn: async (payload) => {
      assert.deepEqual(payload.competitors, []);
      return mlResponse;
    },
  });

  assert.deepEqual(suggestion.competitor_snapshot, {
    count: 0,
    available_count: 0,
    average_price: null,
  });
});

test('duplicate pending suggestions return 409 before ML or insertion', async () => {
  const calls = [];
  let mlCalled = false;
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });

    if (/FROM products/.test(sql)) {
      return { rows: [productRow] };
    }

    if (/SELECT id\s+FROM price_suggestions/.test(sql)) {
      return { rows: [{ id: SUGGESTION_ID }] };
    }

    return { rows: [] };
  });

  await assert.rejects(
    createPendingPriceSuggestion(PRODUCT_ID, {
      poolInstance: pool,
      requestPricingScoreFn: async () => {
        mlCalled = true;
      },
    }),
    (error) => error.statusCode === 409 && /pending price suggestion/.test(error.message)
  );

  assert.equal(mlCalled, false);
  assert.equal(calls.some(({ sql }) => /INSERT INTO/.test(sql)), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(wasReleased(), true);
});

test('inactive or missing products return 404 without calling ML', async () => {
  let mlCalled = false;
  const { pool } = createMockPool(async (sql) => {
    if (sql === 'BEGIN' || sql === 'ROLLBACK') {
      return { rows: [] };
    }

    return { rows: [] };
  });

  await assert.rejects(
    createPendingPriceSuggestion(PRODUCT_ID, {
      poolInstance: pool,
      requestPricingScoreFn: async () => {
        mlCalled = true;
      },
    }),
    (error) => error.statusCode === 404 && error.message === 'Active product not found'
  );
  assert.equal(mlCalled, false);
});

test('ML 502 and 503 errors are preserved and roll back without insertion', async (t) => {
  for (const statusCode of [502, 503]) {
    await t.test(String(statusCode), async () => {
      const calls = [];
      const { pool } = createMockPool(async (sql, params) => {
        calls.push({ sql, params });

        if (/FROM products/.test(sql)) {
          return { rows: [productRow] };
        }

        return { rows: [] };
      });
      const upstreamError = new Error(
        statusCode === 502
          ? 'ML service returned an invalid response'
          : 'ML service is unavailable'
      );
      upstreamError.statusCode = statusCode;

      await assert.rejects(
        createPendingPriceSuggestion(PRODUCT_ID, {
          poolInstance: pool,
          requestPricingScoreFn: async () => {
            throw upstreamError;
          },
        }),
        (error) => error === upstreamError
      );

      assert.equal(calls.at(-1).sql, 'ROLLBACK');
      assert.equal(calls.some(({ sql }) => /INSERT INTO/.test(sql)), false);
    });
  }
});

test('suggestion reads are parameterized, map decimals, and return 404 when missing', async () => {
  const featureVector = {
    price_score: 80.1234,
    action: 'increase',
    model_version: 'bootstrap-xgb-v1',
    model_source: 'synthetic_rule_based',
    competitor_snapshot: { count: 0, available_count: 0, average_price: null },
    raw_candidate: 104.99,
    applied_guardrails: [],
  };
  const row = {
    id: SUGGESTION_ID,
    product_id: PRODUCT_ID,
    product_name: 'Example product',
    sku: 'SKU-1',
    current_price: '99.99',
    suggested_price: '104.99',
    price_score: '80.00',
    status: 'pending',
    feature_vector: featureVector,
    created_at: '2026-07-17T05:00:00.000Z',
  };
  const listCalls = [];
  const listResult = await listPriceSuggestions(
    { status: 'pending', limit: 10 },
    { queryFn: async (sql, params) => {
      listCalls.push({ sql, params });
      return { rows: [row] };
    } }
  );

  assert.deepEqual(listCalls[0].params, ['pending', 10]);
  assert.match(listCalls[0].sql, /ps\.status = \$1/);
  assert.match(listCalls[0].sql, /LIMIT \$2/);
  assert.equal(listResult.items[0].percentage_change, 5);
  assert.equal(listResult.items[0].current_price, 99.99);
  assert.equal(listResult.items[0].suggested_price, 104.99);
  assert.equal(listResult.items[0].price_score, 80.1234);

  const detailCalls = [];
  const detail = await getPriceSuggestionById(SUGGESTION_ID, {
    queryFn: async (sql, params) => {
      detailCalls.push({ sql, params });
      return { rows: [row] };
    },
  });
  assert.equal(detail.id, SUGGESTION_ID);
  assert.deepEqual(detailCalls[0].params, [SUGGESTION_ID]);
  assert.match(detailCalls[0].sql, /ps\.id = \$1/);
  assert.doesNotMatch(detailCalls[0].sql, new RegExp(SUGGESTION_ID));

  await assert.rejects(
    getPriceSuggestionById(SUGGESTION_ID, {
      queryFn: async () => ({ rows: [] }),
    }),
    (error) => error.statusCode === 404 && error.message === 'Price suggestion not found'
  );
});
