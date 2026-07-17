import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  approvePriceSuggestion,
  createPendingPriceSuggestion,
  generatePriceSuggestionRationale,
  getPriceSuggestionById,
  listPriceSuggestions,
  rejectPriceSuggestion,
  scoreProductPricing,
} = await import('../src/services/pricing.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';
const HISTORY_ID = '44444444-4444-4444-8444-444444444444';
const execFileAsync = promisify(execFile);
const apiDirectory = new URL('..', import.meta.url);
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
const persistedRationale = {
  schemaVersion: 'pricing-rationale-v1',
  provider: 'google-gemini',
  model: 'gemini-2.5-flash-lite',
  summary: 'The guarded suggestion is a modest increase.',
  keyFactors: ['The stored score selected an increase action.'],
  risks: ['The competitor snapshot is sparse.'],
  guardrailExplanation: 'The raw candidate was capped by the maximum-price guardrail.',
  limitation: (
    'The score is synthetic and rule-based; it is not confidence. '
    + 'Causal demand and revenue impact are not validated. Human review is required '
    + 'before any future price update.'
  ),
  promptTokenCount: 120,
  outputTokenCount: 80,
  totalTokenCount: 200,
  generatedAt: '2026-07-17T06:00:00.000Z',
};

test('pricing orchestration maps decimals and requests only latest active configured-target rows', async () => {
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
  assert.match(calls[1].sql, /SELECT DISTINCT ON \(ct\.id\)/);
  assert.match(calls[1].sql, /FROM competitor_targets ct/);
  assert.match(calls[1].sql, /JOIN competitor_data cd/);
  assert.match(calls[1].sql, /cd\.product_id = ct\.product_id/);
  assert.match(calls[1].sql, /cd\.competitor_name = ct\.competitor_name/);
  assert.match(calls[1].sql, /cd\.competitor_url = ct\.competitor_url/);
  assert.match(calls[1].sql, /WHERE ct\.product_id = \$1/);
  assert.match(calls[1].sql, /ct\.is_active = TRUE/);
  assert.match(calls[1].sql, /ORDER BY ct\.id, cd\.scraped_at DESC/);
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
          expires_at: '2026-07-18T05:00:00.000Z',
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
  assert.match(calls[2].sql, /SET status = 'expired'/);
  assert.match(calls[2].sql, /COALESCE\(expires_at, created_at \+ \(\$1::int \* INTERVAL '1 hour'\)\)/);
  assert.deepEqual(calls[2].params, [24, PRODUCT_ID]);
  assert.match(calls[3].sql, /status = 'pending'/);
  assert.deepEqual(calls[3].params, [PRODUCT_ID]);

  const insert = calls.find(({ sql }) => /INSERT INTO price_suggestions/.test(sql));
  assert.ok(insert);
  assert.match(insert.sql, /clock_timestamp\(\) \+ \(\$6::int \* INTERVAL '1 hour'\)/);
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
  assert.equal(insert.params[5], 24);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(wasReleased(), true);

  const mutatingSql = calls
    .map(({ sql }) => sql)
    .filter((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
  assert.equal(mutatingSql.length, 2);
  assert.match(mutatingSql[0], /SET status = 'expired'/);
  assert.match(mutatingSql[1], /INSERT INTO price_suggestions/);
  assert.equal(mutatingSql.some((sql) => /UPDATE\s+products|price_history/i.test(sql)), false);
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
    expires_at: '2026-07-18T05:00:00.000Z',
    expiresAt: '2026-07-18T05:00:00.000Z',
    limitation: insert.params[4].limitation,
    aiRationale: null,
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

function createDecisionSuggestionRow(overrides = {}) {
  return {
    id: SUGGESTION_ID,
    product_id: PRODUCT_ID,
    product_name: 'Example product',
    sku: 'SKU-1',
    current_price: '100.00',
    suggested_price: '105.00',
    price_score: '80.00',
    status: 'pending',
    approved_by: null,
    approved_at: null,
    expires_at: null,
    feature_vector: {
      price_score: 80,
      action: 'increase',
      model_version: 'bootstrap-xgb-v1',
      model_source: 'synthetic_rule_based',
      competitor_snapshot: { count: 0, available_count: 0, average_price: null },
      raw_candidate: 105,
      applied_guardrails: [],
    },
    ai_rationale: JSON.stringify(persistedRationale),
    created_at: '2026-07-17T05:00:00.000Z',
    ...overrides,
  };
}

function createDecisionProductRow(overrides = {}) {
  return {
    ...productRow,
    is_active: true,
    ...overrides,
  };
}

test('approval locks both rows and atomically updates price, review data, and one history row', async () => {
  const calls = [];
  const reviewedAt = '2026-07-17T07:00:00.000Z';
  const historyCreatedAt = '2026-07-17T07:00:01.000Z';
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });

    if (/FROM price_suggestions ps/.test(sql)) {
      return { rows: [createDecisionSuggestionRow()] };
    }

    if (/FROM products/.test(sql)) {
      return { rows: [createDecisionProductRow()] };
    }

    if (/SET status = 'expired'/.test(sql)) {
      return { rows: [] };
    }

    if (/UPDATE price_suggestions/.test(sql)) {
      return {
        rows: [createDecisionSuggestionRow({
          status: 'approved',
          approved_by: REVIEWER_ID,
          approved_at: reviewedAt,
        })],
      };
    }

    if (/INSERT INTO price_history/.test(sql)) {
      return {
        rows: [{
          id: HISTORY_ID,
          product_id: PRODUCT_ID,
          old_price: '100.00',
          new_price: '105.00',
          change_reason: 'suggestion_approved',
          suggestion_id: SUGGESTION_ID,
          changed_by: REVIEWER_ID,
          created_at: historyCreatedAt,
        }],
      };
    }

    return { rows: [] };
  });

  const result = await approvePriceSuggestion(SUGGESTION_ID, REVIEWER_ID, {
    poolInstance: pool,
  });

  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /WHERE ps\.id = \$1[\s\S]*FOR UPDATE OF ps/);
  assert.deepEqual(calls[1].params, [SUGGESTION_ID]);
  assert.match(calls[2].sql, /SET status = 'expired'/);
  assert.deepEqual(calls[2].params, [24, SUGGESTION_ID]);
  assert.match(calls[3].sql, /FROM products[\s\S]*WHERE id = \$1[\s\S]*FOR UPDATE/);
  assert.deepEqual(calls[3].params, [PRODUCT_ID]);

  const productUpdates = calls.filter(({ sql }) => /UPDATE products/.test(sql));
  assert.equal(productUpdates.length, 1);
  assert.deepEqual(productUpdates[0].params, [PRODUCT_ID, '105.00']);

  const suggestionUpdates = calls.filter(({ sql }) => /SET status = 'approved'/.test(sql));
  assert.equal(suggestionUpdates.length, 1);
  assert.deepEqual(suggestionUpdates[0].params, [SUGGESTION_ID, REVIEWER_ID, 24]);
  assert.match(suggestionUpdates[0].sql, /status = 'approved'/);
  assert.match(suggestionUpdates[0].sql, /approved_by = \$2/);
  assert.match(suggestionUpdates[0].sql, /approved_at = NOW\(\)/);
  assert.match(suggestionUpdates[0].sql, /status = 'pending'/);
  assert.match(suggestionUpdates[0].sql, /> clock_timestamp\(\)/);
  assert.doesNotMatch(
    suggestionUpdates[0].sql.split(/WHERE/i)[0],
    /feature_vector|ai_rationale|suggested_price|current_price|price_score/
  );

  const historyInserts = calls.filter(({ sql }) => /INSERT INTO price_history/.test(sql));
  assert.equal(historyInserts.length, 1);
  assert.deepEqual(historyInserts[0].params, [
    PRODUCT_ID,
    '100.00',
    '105.00',
    SUGGESTION_ID,
    REVIEWER_ID,
  ]);
  assert.match(historyInserts[0].sql, /'suggestion_approved'/);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(wasReleased(), true);

  assert.equal(result.old_price, 100);
  assert.equal(result.new_price, 105);
  assert.equal(result.suggestion.status, 'approved');
  assert.equal(result.suggestion.approved_by, REVIEWER_ID);
  assert.equal(result.suggestion.approved_at, reviewedAt);
  assert.deepEqual(result.suggestion.aiRationale, persistedRationale);
  assert.equal(result.suggestion.action, 'increase');
  assert.equal(result.suggestion.model_version, 'bootstrap-xgb-v1');
  assert.deepEqual(result.price_history, {
    id: HISTORY_ID,
    product_id: PRODUCT_ID,
    old_price: 100,
    new_price: 105,
    change_reason: 'suggestion_approved',
    suggestion_id: SUGGESTION_ID,
    changed_by: REVIEWER_ID,
    created_at: historyCreatedAt,
  });
});

test('rejection only transitions the locked suggestion and preserves saved decision data', async () => {
  const calls = [];
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });

    if (/FROM price_suggestions ps/.test(sql)) {
      return { rows: [createDecisionSuggestionRow()] };
    }

    if (/SET status = 'expired'/.test(sql)) {
      return { rows: [] };
    }

    if (/UPDATE price_suggestions/.test(sql)) {
      return {
        rows: [createDecisionSuggestionRow({
          status: 'rejected',
        })],
      };
    }

    return { rows: [] };
  });

  const suggestion = await rejectPriceSuggestion(SUGGESTION_ID, {
    poolInstance: pool,
  });

  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /FOR UPDATE OF ps/);
  const suggestionUpdates = calls.filter(({ sql }) => /SET status = 'rejected'/.test(sql));
  assert.equal(suggestionUpdates.length, 1);
  assert.deepEqual(suggestionUpdates[0].params, [SUGGESTION_ID, 24]);
  assert.match(suggestionUpdates[0].sql, /> clock_timestamp\(\)/);
  assert.doesNotMatch(suggestionUpdates[0].sql.split(/WHERE/i)[0], /approved_by|approved_at/);
  assert.equal(calls.some(({ sql }) => /UPDATE products|INSERT INTO price_history/.test(sql)), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(wasReleased(), true);
  assert.equal(suggestion.status, 'rejected');
  assert.equal(suggestion.approved_by, null);
  assert.equal(suggestion.approved_at, null);
  assert.equal(suggestion.current_price, 100);
  assert.equal(suggestion.suggested_price, 105);
  assert.deepEqual(suggestion.aiRationale, persistedRationale);
});

test('due suggestions persist expired and cannot be approved or rejected', async (t) => {
  for (const operation of ['approve', 'reject']) {
    await t.test(operation, async () => {
      const calls = [];
      const { pool, wasReleased } = createMockPool(async (sql, params) => {
        calls.push({ sql, params });

        if (/FROM price_suggestions ps/.test(sql)) {
          return {
            rows: [createDecisionSuggestionRow({
              expires_at: null,
              created_at: '2020-01-01T00:00:00.000Z',
            })],
          };
        }

        if (/SET status = 'expired'/.test(sql)) {
          return { rows: [{ id: SUGGESTION_ID, status: 'expired' }] };
        }

        return { rows: [] };
      });
      const promise = operation === 'approve'
        ? approvePriceSuggestion(SUGGESTION_ID, REVIEWER_ID, { poolInstance: pool })
        : rejectPriceSuggestion(SUGGESTION_ID, { poolInstance: pool });

      await assert.rejects(
        promise,
        (error) => error.statusCode === 409 && /expired/.test(error.message)
      );

      const expiryUpdate = calls.find(({ sql }) => /SET status = 'expired'/.test(sql));
      assert.deepEqual(expiryUpdate.params, [24, SUGGESTION_ID]);
      assert.match(expiryUpdate.sql, /expires_at = COALESCE/);
      assert.equal(calls.at(-1).sql, 'COMMIT');
      assert.equal(calls.some(({ sql }) => /UPDATE products|INSERT INTO price_history/.test(sql)), false);
      assert.equal(wasReleased(), true);
    });
  }
});

test('approval conflicts and missing records roll back before any write', async (t) => {
  const cases = [
    {
      name: 'missing suggestion',
      suggestion: null,
      expectedStatus: 404,
      expectedMessage: /suggestion not found/i,
    },
    {
      name: 'already decided suggestion',
      suggestion: createDecisionSuggestionRow({ status: 'rejected' }),
      expectedStatus: 409,
      expectedMessage: /no longer pending/i,
    },
    {
      name: 'missing product',
      suggestion: createDecisionSuggestionRow(),
      product: null,
      expectedStatus: 404,
      expectedMessage: /product not found/i,
    },
    {
      name: 'inactive product',
      suggestion: createDecisionSuggestionRow(),
      product: createDecisionProductRow({ is_active: false }),
      expectedStatus: 409,
      expectedMessage: /no longer active/i,
    },
    {
      name: 'stale product price',
      suggestion: createDecisionSuggestionRow(),
      product: createDecisionProductRow({ current_price: '101.00' }),
      expectedStatus: 409,
      expectedMessage: /price changed/i,
    },
    {
      name: 'cost guardrail changed',
      suggestion: createDecisionSuggestionRow({ suggested_price: '90.00' }),
      product: createDecisionProductRow({ cost_price: '95.00' }),
      expectedStatus: 409,
      expectedMessage: /guardrails/i,
    },
    {
      name: 'minimum guardrail changed',
      suggestion: createDecisionSuggestionRow({ suggested_price: '90.00' }),
      product: createDecisionProductRow({ min_price: '95.00' }),
      expectedStatus: 409,
      expectedMessage: /guardrails/i,
    },
    {
      name: 'maximum guardrail changed',
      suggestion: createDecisionSuggestionRow(),
      product: createDecisionProductRow({ max_price: '102.00' }),
      expectedStatus: 409,
      expectedMessage: /guardrails/i,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const calls = [];
      const { pool, wasReleased } = createMockPool(async (sql, params) => {
        calls.push({ sql, params });

        if (/FROM price_suggestions ps/.test(sql)) {
          return { rows: testCase.suggestion ? [testCase.suggestion] : [] };
        }

        if (/FROM products/.test(sql)) {
          return { rows: testCase.product ? [testCase.product] : [] };
        }

        return { rows: [] };
      });

      await assert.rejects(
        approvePriceSuggestion(SUGGESTION_ID, REVIEWER_ID, { poolInstance: pool }),
        (error) => (
          error.statusCode === testCase.expectedStatus
          && testCase.expectedMessage.test(error.message)
        )
      );

      assert.equal(
        calls.some(({ sql }) => (
          /^\s*(UPDATE|INSERT|DELETE)/i.test(sql)
          && !/SET status = 'expired'/.test(sql)
        )),
        false
      );
      assert.equal(calls.at(-1).sql, 'ROLLBACK');
      assert.equal(wasReleased(), true);
    });
  }
});

test('an unexpected suggestion failure rolls back before product or history writes', async () => {
  const calls = [];
  const databaseError = new Error('database write failed');
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });

    if (/FROM price_suggestions ps/.test(sql)) {
      return { rows: [createDecisionSuggestionRow()] };
    }

    if (/FROM products/.test(sql)) {
      return { rows: [createDecisionProductRow()] };
    }

    if (/SET status = 'expired'/.test(sql)) {
      return { rows: [] };
    }

    if (/UPDATE price_suggestions/.test(sql)) {
      throw databaseError;
    }

    return { rows: [] };
  });

  await assert.rejects(
    approvePriceSuggestion(SUGGESTION_ID, REVIEWER_ID, { poolInstance: pool }),
    (error) => error === databaseError
  );

  assert.equal(calls.filter(({ sql }) => /UPDATE products/.test(sql)).length, 0);
  assert.equal(calls.some(({ sql }) => /INSERT INTO price_history/.test(sql)), false);
  assert.equal(calls.some(({ sql }) => sql === 'COMMIT'), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(wasReleased(), true);
});

test('two simultaneous approvals serialize so only one price change and history insert succeed', async () => {
  let suggestionStatus = 'pending';
  let productPrice = '100.00';
  let lockHeld = false;
  const lockWaiters = [];
  let productUpdateCount = 0;
  let historyInsertCount = 0;

  function releaseLock(client) {
    if (!client.hasSuggestionLock) {
      return;
    }

    client.hasSuggestionLock = false;
    lockHeld = false;
    lockWaiters.shift()?.();
  }

  const pool = {
    async connect() {
      const client = {
        hasSuggestionLock: false,
        release() {},
        async query(sql, params) {
          if (/FROM price_suggestions ps/.test(sql)) {
            if (lockHeld) {
              await new Promise((resolve) => lockWaiters.push(resolve));
            }

            lockHeld = true;
            client.hasSuggestionLock = true;
            return { rows: [createDecisionSuggestionRow({ status: suggestionStatus })] };
          }

          if (/FROM products/.test(sql)) {
            return { rows: [createDecisionProductRow({ current_price: productPrice })] };
          }

          if (/SET status = 'expired'/.test(sql)) {
            return { rows: [] };
          }

          if (/UPDATE products/.test(sql)) {
            productUpdateCount += 1;
            productPrice = params[1];
            return { rows: [] };
          }

          if (/UPDATE price_suggestions/.test(sql)) {
            suggestionStatus = 'approved';
            return {
              rows: [createDecisionSuggestionRow({
                status: suggestionStatus,
                approved_by: params[1],
                approved_at: '2026-07-17T07:00:00.000Z',
              })],
            };
          }

          if (/INSERT INTO price_history/.test(sql)) {
            historyInsertCount += 1;
            return {
              rows: [{
                id: HISTORY_ID,
                product_id: PRODUCT_ID,
                old_price: '100.00',
                new_price: '105.00',
                change_reason: 'suggestion_approved',
                suggestion_id: SUGGESTION_ID,
                changed_by: REVIEWER_ID,
                created_at: '2026-07-17T07:00:01.000Z',
              }],
            };
          }

          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            releaseLock(client);
          }

          return { rows: [] };
        },
      };

      return client;
    },
  };

  const decisions = await Promise.allSettled([
    approvePriceSuggestion(SUGGESTION_ID, REVIEWER_ID, { poolInstance: pool }),
    approvePriceSuggestion(SUGGESTION_ID, REVIEWER_ID, { poolInstance: pool }),
  ]);

  assert.equal(decisions.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = decisions.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.statusCode, 409);
  assert.equal(productPrice, '105.00');
  assert.equal(productUpdateCount, 1);
  assert.equal(historyInsertCount, 1);
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
    approved_by: null,
    approved_at: null,
    expires_at: null,
    feature_vector: featureVector,
    ai_rationale: null,
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

  assert.deepEqual(listCalls[0].params, [24]);
  assert.match(listCalls[0].sql, /SET status = 'expired'/);
  assert.deepEqual(listCalls[1].params, ['pending', 10]);
  assert.match(listCalls[1].sql, /ps\.status = \$1/);
  assert.match(listCalls[1].sql, /LIMIT \$2/);
  assert.equal(listResult.items[0].percentage_change, 5);
  assert.equal(listResult.items[0].current_price, 99.99);
  assert.equal(listResult.items[0].suggested_price, 104.99);
  assert.equal(listResult.items[0].price_score, 80.1234);
  assert.equal(listResult.items[0].aiRationale, null);
  assert.equal(listResult.items[0].approved_by, null);
  assert.equal(listResult.items[0].approved_at, null);
  assert.equal(listResult.items[0].expiresAt, '2026-07-18T05:00:00.000Z');

  const detailCalls = [];
  const detail = await getPriceSuggestionById(SUGGESTION_ID, {
    queryFn: async (sql, params) => {
      detailCalls.push({ sql, params });
      return {
        rows: [{
          ...row,
          status: 'approved',
          approved_by: REVIEWER_ID,
          approved_at: '2026-07-17T07:00:00.000Z',
          ai_rationale: JSON.stringify(persistedRationale),
        }],
      };
    },
  });
  assert.equal(detail.id, SUGGESTION_ID);
  assert.equal(detail.status, 'approved');
  assert.equal(detail.approved_by, REVIEWER_ID);
  assert.equal(detail.approved_at, '2026-07-17T07:00:00.000Z');
  assert.deepEqual(detail.aiRationale, persistedRationale);
  assert.deepEqual(detailCalls[0].params, [24, SUGGESTION_ID]);
  assert.match(detailCalls[0].sql, /SET status = 'expired'/);
  assert.deepEqual(detailCalls[1].params, [SUGGESTION_ID]);
  assert.match(detailCalls[1].sql, /ps\.id = \$1/);
  assert.doesNotMatch(detailCalls[1].sql, new RegExp(SUGGESTION_ID));
  assert.equal(detail.expiresAt, null);

  await assert.rejects(
    getPriceSuggestionById(SUGGESTION_ID, {
      queryFn: async () => ({ rows: [] }),
    }),
    (error) => error.statusCode === 404 && error.message === 'Price suggestion not found'
  );
});

test('list and detail reads persist and expose truthful expired status and expiresAt', async () => {
  const expiresAt = '2026-07-18T05:00:00.000Z';
  let status = 'pending';
  const row = {
    id: SUGGESTION_ID,
    product_id: PRODUCT_ID,
    product_name: 'Example product',
    sku: 'SKU-1',
    current_price: '100.00',
    suggested_price: '105.00',
    price_score: '80.00',
    status,
    approved_by: null,
    approved_at: null,
    expires_at: null,
    feature_vector: {},
    ai_rationale: null,
    created_at: '2026-07-17T05:00:00.000Z',
  };
  const queryFn = async (sql) => {
    if (/SET status = 'expired'/.test(sql) && status === 'pending') {
      status = 'expired';
      return { rows: [{ id: SUGGESTION_ID, status }] };
    }

    return { rows: [{ ...row, status, expires_at: expiresAt }] };
  };

  const list = await listPriceSuggestions(
    { status: 'expired', limit: 10 },
    { queryFn }
  );
  const detail = await getPriceSuggestionById(SUGGESTION_ID, { queryFn });

  assert.equal(list.items[0].status, 'expired');
  assert.equal(list.items[0].expiresAt, expiresAt);
  assert.equal(detail.status, 'expired');
  assert.equal(detail.expiresAt, expiresAt);
});

function createRationaleSuggestionRow(overrides = {}) {
  return {
    id: SUGGESTION_ID,
    product_id: PRODUCT_ID,
    product_name: 'Example product',
    sku: 'SKU-1',
    current_price: '100.00',
    suggested_price: '105.00',
    price_score: '80.00',
    status: 'pending',
    feature_vector: {
      price_score: 80,
      action: 'increase',
      model_version: 'bootstrap-xgb-v1',
      model_source: 'synthetic_rule_based',
      features: { has_competitor_data: 1 },
      competitor_snapshot: { count: 2, available_count: 1, average_price: 95.5 },
      raw_candidate: 106,
      final_guarded_candidate: 105,
      applied_guardrails: ['max_price'],
      limitation: 'Stored deterministic Day 17 limitation.',
    },
    ai_rationale: null,
    created_at: '2026-07-17T05:00:00.000Z',
    ...overrides,
  };
}

test('rationale generation uses the saved snapshot and atomically persists only rationale JSON', async () => {
  const calls = [];
  let modelCallCount = 0;
  const result = await generatePriceSuggestionRationale(SUGGESTION_ID, {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });

      if (/UPDATE price_suggestions/.test(sql)) {
        return { rows: [{ ai_rationale: params[1] }] };
      }

      return { rows: [createRationaleSuggestionRow()] };
    },
    generateRationaleFn: async (facts) => {
      modelCallCount += 1;
      assert.deepEqual(facts, {
        product: { name: 'Example product', sku: 'SKU-1' },
        currentPrice: 100,
        suggestedPrice: 105,
        percentageChange: 5,
        priceScore: 80,
        action: 'increase',
        modelVersion: 'bootstrap-xgb-v1',
        modelSource: 'synthetic_rule_based',
        featureVector: { has_competitor_data: 1 },
        competitorSnapshot: { count: 2, availableCount: 1, averagePrice: 95.5 },
        rawCandidate: 106,
        appliedGuardrails: ['max_price'],
        existingLimitation: 'Stored deterministic Day 17 limitation.',
      });
      assert.equal(JSON.stringify(facts).includes(PRODUCT_ID), false);
      assert.equal(JSON.stringify(facts).includes('http'), false);
      return persistedRationale;
    },
  });

  assert.equal(modelCallCount, 1);
  assert.deepEqual(result, {
    generated: true,
    suggestionId: SUGGESTION_ID,
    rationale: persistedRationale,
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].params, [24, SUGGESTION_ID]);
  assert.match(calls[0].sql, /SET status = 'expired'/);
  assert.deepEqual(calls[1].params, [SUGGESTION_ID]);
  assert.match(calls[1].sql, /WHERE ps\.id = \$1/);
  assert.doesNotMatch(calls[1].sql, /competitor_data|competitor_targets|competitor_url/i);
  assert.doesNotMatch(calls[1].sql, new RegExp(SUGGESTION_ID));

  const update = calls[2];
  assert.deepEqual(update.params, [SUGGESTION_ID, JSON.stringify(persistedRationale), 24]);
  assert.match(update.sql, /SET ai_rationale = \$2/);
  assert.match(update.sql, /WHERE id = \$1/);
  assert.match(update.sql, /status = 'pending'/);
  assert.match(update.sql, /ai_rationale IS NULL/);
  assert.match(update.sql, /COALESCE\([\s\S]*expires_at[\s\S]*\) > clock_timestamp\(\)/);
  assert.deepEqual(JSON.parse(update.params[1]), persistedRationale);
  const setClause = update.sql.split(/WHERE/i)[0];
  assert.doesNotMatch(
    setClause,
    /suggested_price|current_price|price_score|confidence_score|status|product/i
  );
  const mutations = calls.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
  assert.equal(mutations.length, 2);
  assert.equal(mutations.some(({ sql }) => /UPDATE\s+products|price_history/i.test(sql)), false);
  assert.equal(calls.some(({ sql }) => /BEGIN|COMMIT|ROLLBACK/.test(sql)), false);
});

test('an existing rationale is returned without a second model call or update', async () => {
  const calls = [];
  let modelCalled = false;
  const result = await generatePriceSuggestionRationale(SUGGESTION_ID, {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rows: [createRationaleSuggestionRow({
          ai_rationale: JSON.stringify({
            ...persistedRationale,
            limitation: 'A model-controlled warning must not replace the server warning.',
          }),
        })],
      };
    },
    generateRationaleFn: async () => {
      modelCalled = true;
    },
  });

  assert.equal(modelCalled, false);
  assert.equal(calls.length, 3);
  assert.equal(calls.some(({ sql }) => /SET ai_rationale/.test(sql)), false);
  assert.deepEqual(result, {
    generated: false,
    suggestionId: SUGGESTION_ID,
    rationale: persistedRationale,
  });
});

test('unusable or unavailable Gemini results never reach persistence', async (t) => {
  const failures = [
    Object.assign(new Error('Gemini returned an invalid rationale response'), { statusCode: 502 }),
    Object.assign(new Error('Gemini rationale service is unavailable'), { statusCode: 503 }),
  ];

  for (const failure of failures) {
    await t.test(String(failure.statusCode), async () => {
      const calls = [];

      await assert.rejects(
        generatePriceSuggestionRationale(SUGGESTION_ID, {
          queryFn: async (sql, params) => {
            calls.push({ sql, params });
            return { rows: [createRationaleSuggestionRow()] };
          },
          generateRationaleFn: async () => {
            throw failure;
          },
        }),
        (error) => error === failure
      );

      assert.equal(calls.length, 2);
      assert.equal(
        calls.some(({ sql }) => /SET ai_rationale/.test(sql)),
        false
      );
    });
  }
});

test('missing and non-pending suggestions reject before calling Gemini', async (t) => {
  await t.test('missing', async () => {
    let modelCalled = false;

    await assert.rejects(
      generatePriceSuggestionRationale(SUGGESTION_ID, {
        queryFn: async () => ({ rows: [] }),
        generateRationaleFn: async () => {
          modelCalled = true;
        },
      }),
      (error) => error.statusCode === 404 && error.message === 'Price suggestion not found'
    );
    assert.equal(modelCalled, false);
  });

  await t.test('not pending', async () => {
    let modelCalled = false;

    await assert.rejects(
      generatePriceSuggestionRationale(SUGGESTION_ID, {
        queryFn: async () => ({
          rows: [createRationaleSuggestionRow({ status: 'approved' })],
        }),
        generateRationaleFn: async () => {
          modelCalled = true;
        },
      }),
      (error) => error.statusCode === 409 && /no longer pending/.test(error.message)
    );
    assert.equal(modelCalled, false);
  });
});

test('a concurrent atomic winner is returned without overwriting its rationale', async () => {
  const calls = [];
  const concurrentRationale = {
    ...persistedRationale,
    summary: 'Another request persisted this rationale first.',
  };
  const result = await generatePriceSuggestionRationale(SUGGESTION_ID, {
    queryFn: async (sql) => {
      calls.push(sql);

      if (/SET status = 'expired'/.test(sql)) {
        return { rows: [] };
      }

      if (/FROM price_suggestions ps/.test(sql)) {
        return { rows: [createRationaleSuggestionRow()] };
      }

      if (/UPDATE price_suggestions/.test(sql)) {
        return { rows: [] };
      }

      return {
        rows: [{ status: 'pending', ai_rationale: JSON.stringify(concurrentRationale) }],
      };
    },
    generateRationaleFn: async () => persistedRationale,
  });

  assert.equal(calls.length, 5);
  assert.deepEqual(result, {
    generated: false,
    suggestionId: SUGGESTION_ID,
    rationale: concurrentRationale,
  });
});

test('due suggestions persist expired and reject rationale before Gemini', async () => {
  const calls = [];
  let modelCalled = false;

  await assert.rejects(
    generatePriceSuggestionRationale(SUGGESTION_ID, {
      queryFn: async (sql, params) => {
        calls.push({ sql, params });
        return /SET status = 'expired'/.test(sql)
          ? { rows: [{ id: SUGGESTION_ID, status: 'expired' }] }
          : { rows: [] };
      },
      generateRationaleFn: async () => {
        modelCalled = true;
      },
    }),
    (error) => error.statusCode === 409 && /expired/.test(error.message)
  );

  assert.equal(modelCalled, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [24, SUGGESTION_ID]);
  assert.doesNotMatch(calls[0].sql, /ai_rationale/);
});

test('price suggestion TTL defaults to 24 hours and rejects values outside 1-720', async (t) => {
  const baseEnvironment = {
    ...process.env,
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
  };
  delete baseEnvironment.PRICE_SUGGESTION_TTL_HOURS;
  const command = [
    '--input-type=module',
    '-e',
    "const env = await import('./src/config/env.js'); process.stdout.write(String(env.PRICE_SUGGESTION_TTL_HOURS));",
  ];
  const defaultResult = await execFileAsync(process.execPath, command, {
    cwd: apiDirectory,
    env: baseEnvironment,
  });

  assert.equal(defaultResult.stdout, '24');

  for (const value of ['0', '721', '1.5']) {
    await t.test(value, async () => {
      await assert.rejects(
        execFileAsync(process.execPath, command, {
          cwd: apiDirectory,
          env: { ...baseEnvironment, PRICE_SUGGESTION_TTL_HOURS: value },
        }),
        (error) => {
          assert.match(error.stderr, /PRICE_SUGGESTION_TTL_HOURS must be an integer between 1 and 720/);
          return true;
        }
      );
    });
  }
});
