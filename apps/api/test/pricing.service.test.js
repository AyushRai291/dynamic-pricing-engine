import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createPendingPriceSuggestion,
  generatePriceSuggestionRationale,
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

  assert.deepEqual(listCalls[0].params, ['pending', 10]);
  assert.match(listCalls[0].sql, /ps\.status = \$1/);
  assert.match(listCalls[0].sql, /LIMIT \$2/);
  assert.equal(listResult.items[0].percentage_change, 5);
  assert.equal(listResult.items[0].current_price, 99.99);
  assert.equal(listResult.items[0].suggested_price, 104.99);
  assert.equal(listResult.items[0].price_score, 80.1234);
  assert.equal(listResult.items[0].aiRationale, null);

  const detailCalls = [];
  const detail = await getPriceSuggestionById(SUGGESTION_ID, {
    queryFn: async (sql, params) => {
      detailCalls.push({ sql, params });
      return {
        rows: [{
          ...row,
          ai_rationale: JSON.stringify(persistedRationale),
        }],
      };
    },
  });
  assert.equal(detail.id, SUGGESTION_ID);
  assert.deepEqual(detail.aiRationale, persistedRationale);
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
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, [SUGGESTION_ID]);
  assert.match(calls[0].sql, /WHERE ps\.id = \$1/);
  assert.doesNotMatch(calls[0].sql, /competitor_data|competitor_targets|competitor_url/i);
  assert.doesNotMatch(calls[0].sql, new RegExp(SUGGESTION_ID));

  const update = calls[1];
  assert.deepEqual(update.params, [SUGGESTION_ID, JSON.stringify(persistedRationale)]);
  assert.match(update.sql, /SET ai_rationale = \$2/);
  assert.match(update.sql, /WHERE id = \$1/);
  assert.match(update.sql, /status = 'pending'/);
  assert.match(update.sql, /ai_rationale IS NULL/);
  assert.deepEqual(JSON.parse(update.params[1]), persistedRationale);
  const setClause = update.sql.split(/WHERE/i)[0];
  assert.doesNotMatch(
    setClause,
    /suggested_price|current_price|price_score|confidence_score|status|product/i
  );
  const mutations = calls.filter(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
  assert.equal(mutations.length, 1);
  assert.doesNotMatch(mutations[0].sql, /UPDATE\s+products|price_history/i);
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
  assert.equal(calls.length, 1);
  assert.equal(calls.some(({ sql }) => /^\s*UPDATE/i.test(sql)), false);
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

      assert.equal(calls.length, 1);
      assert.equal(
        calls.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql)),
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
  let callCount = 0;
  const concurrentRationale = {
    ...persistedRationale,
    summary: 'Another request persisted this rationale first.',
  };
  const result = await generatePriceSuggestionRationale(SUGGESTION_ID, {
    queryFn: async (sql) => {
      callCount += 1;

      if (callCount === 1) {
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

  assert.equal(callCount, 3);
  assert.deepEqual(result, {
    generated: false,
    suggestionId: SUGGESTION_ID,
    rationale: concurrentRationale,
  });
});
