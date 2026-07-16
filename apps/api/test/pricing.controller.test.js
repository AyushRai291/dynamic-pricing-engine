import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createGenerateSuggestionRationaleHandler,
  createGetSuggestionHandler,
  createListSuggestionsHandler,
  createProductSuggestionHandler,
  parseSuggestionListQuery,
  validateCreateSuggestionBody,
  validatePricingUuid,
} = await import('../src/controllers/pricing.controller.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { default: pricingRoutes } = await import('../src/routes/pricing.routes.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

function assertBadRequest(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 400);
    assert.match(error.message, pattern);
    return true;
  });
}

function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        resolve({ statusCode: this.statusCode, body });
      },
    };

    handler(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ statusCode: res.statusCode });
    });
  });
}

test('pricing UUID, empty-body, status, and limit validation rejects malformed input', () => {
  assert.equal(validatePricingUuid(PRODUCT_ID, 'product'), PRODUCT_ID);
  assertBadRequest(() => validatePricingUuid('bad', 'product'), /Invalid product id/);
  assertBadRequest(() => validatePricingUuid('bad', 'suggestion'), /Invalid suggestion id/);

  assert.doesNotThrow(() => validateCreateSuggestionBody(undefined));
  assert.doesNotThrow(() => validateCreateSuggestionBody({}));
  assertBadRequest(() => validateCreateSuggestionBody([]), /empty JSON object/);
  assertBadRequest(() => validateCreateSuggestionBody({ price: 10 }), /must not contain fields/);

  assert.deepEqual(parseSuggestionListQuery({}), { status: 'pending', limit: 20 });
  assert.deepEqual(parseSuggestionListQuery({ status: 'rejected', limit: '100' }), {
    status: 'rejected',
    limit: 100,
  });

  for (const limit of ['0', '101', '1.5', 'bad']) {
    assertBadRequest(() => parseSuggestionListQuery({ limit }), /limit must be an integer/);
  }

  assertBadRequest(() => parseSuggestionListQuery({ status: 'unknown' }), /status must be/);
  assertBadRequest(() => parseSuggestionListQuery({ page: '1' }), /Invalid query field/);
});

test('create and read handlers pass validated input and use endpoint response contracts', async () => {
  const savedSuggestion = { id: SUGGESTION_ID, status: 'pending' };
  let createProductId;
  const createHandler = createProductSuggestionHandler({
    createFn: async (productId) => {
      createProductId = productId;
      return savedSuggestion;
    },
  });
  const createResponse = await invokeHandler(createHandler, {
    params: { id: PRODUCT_ID },
    body: {},
  });

  assert.equal(createProductId, PRODUCT_ID);
  assert.deepEqual(createResponse, {
    statusCode: 201,
    body: { suggestion: savedSuggestion },
  });

  let listFilters;
  const listHandler = createListSuggestionsHandler({
    listFn: async (filters) => {
      listFilters = filters;
      return { items: [savedSuggestion], limit: filters.limit };
    },
  });
  const listResponse = await invokeHandler(listHandler, {
    query: { status: 'pending', limit: '5' },
  });

  assert.deepEqual(listFilters, { status: 'pending', limit: 5 });
  assert.deepEqual(listResponse, {
    statusCode: 200,
    body: { items: [savedSuggestion], limit: 5 },
  });

  let detailId;
  const getHandler = createGetSuggestionHandler({
    getFn: async (id) => {
      detailId = id;
      return savedSuggestion;
    },
  });
  const detailResponse = await invokeHandler(getHandler, {
    params: { id: SUGGESTION_ID },
  });

  assert.equal(detailId, SUGGESTION_ID);
  assert.deepEqual(detailResponse, {
    statusCode: 200,
    body: { suggestion: savedSuggestion },
  });
});

test('rationale handler validates input and returns generated or existing contracts', async () => {
  const rationale = { schemaVersion: 'pricing-rationale-v1' };
  const calls = [];
  const generatedHandler = createGenerateSuggestionRationaleHandler({
    generateFn: async (id) => {
      calls.push(id);
      return { generated: true, suggestionId: id, rationale };
    },
  });
  const generatedResponse = await invokeHandler(generatedHandler, {
    params: { id: SUGGESTION_ID },
    body: {},
  });

  assert.deepEqual(calls, [SUGGESTION_ID]);
  assert.deepEqual(generatedResponse, {
    statusCode: 201,
    body: {
      generated: true,
      suggestionId: SUGGESTION_ID,
      rationale,
    },
  });

  const existingHandler = createGenerateSuggestionRationaleHandler({
    generateFn: async (id) => ({ generated: false, suggestionId: id, rationale }),
  });
  const existingResponse = await invokeHandler(existingHandler, {
    params: { id: SUGGESTION_ID },
    body: undefined,
  });

  assert.deepEqual(existingResponse, {
    statusCode: 200,
    body: {
      generated: false,
      suggestionId: SUGGESTION_ID,
      rationale,
    },
  });

  await assert.rejects(
    invokeHandler(generatedHandler, { params: { id: 'bad' }, body: {} }),
    (error) => error.statusCode === 400 && /Invalid suggestion id/.test(error.message)
  );
  await assert.rejects(
    invokeHandler(generatedHandler, {
      params: { id: SUGGESTION_ID },
      body: { regenerate: true },
    }),
    (error) => error.statusCode === 400 && /must not contain fields/.test(error.message)
  );
});

test('suggestion endpoints require JWT authentication', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/pricing', pricingRoutes);
  app.use(errorMiddleware);

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const port = server.address().port;
  const responses = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/pricing/products/${PRODUCT_ID}/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    fetch(`http://127.0.0.1:${port}/api/pricing/suggestions?status=pending&limit=10`),
    fetch(`http://127.0.0.1:${port}/api/pricing/suggestions/${SUGGESTION_ID}`),
    fetch(`http://127.0.0.1:${port}/api/pricing/suggestions/${SUGGESTION_ID}/rationale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: {
        message: 'Missing or invalid authorization token',
        statusCode: 401,
      },
    });
  }
});
