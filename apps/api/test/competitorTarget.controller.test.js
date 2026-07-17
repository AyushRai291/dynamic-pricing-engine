import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createCreateCompetitorTargetHandler,
  createListCompetitorTargetsHandler,
  createListGlobalCompetitorTargetsHandler,
  createUpdateCompetitorTargetHandler,
  parseCreateTargetBody,
  parseGlobalTargetQuery,
  parsePatchTargetBody,
  validateTargetUuid,
} = await import('../src/controllers/competitorTarget.controller.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { default: productRoutes } = await import('../src/routes/product.routes.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

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

    handler(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

test('target validation trims names and accepts only safe HTTP/HTTPS URLs', () => {
  assert.equal(validateTargetUuid(PRODUCT_ID, 'product'), PRODUCT_ID);
  assertBadRequest(() => validateTargetUuid('bad', 'product'), /Invalid product id/);
  assertBadRequest(() => validateTargetUuid('bad', 'target'), /Invalid target id/);

  assert.deepEqual(parseCreateTargetBody({
    competitorName: '  Example Store  ',
    competitorUrl: 'https://shop.example/product/123',
  }), {
    competitorName: 'Example Store',
    competitorUrl: 'https://shop.example/product/123',
  });

  assertBadRequest(
    () => parseCreateTargetBody({ competitorName: 'Store', competitorUrl: 'ftp://example.com/p' }),
    /HTTP or HTTPS/
  );
  assertBadRequest(
    () => parseCreateTargetBody({
      competitorName: 'Store',
      competitorUrl: 'https://user:secret@example.com/p',
    }),
    /credentials/
  );
});

test('obvious local and private URL targets are blocked unless explicitly overridden', () => {
  const blockedUrls = [
    'http://localhost/product',
    'http://localhost./product',
    'http://127.0.0.1/product',
    'http://169.254.1.1/product',
    'http://10.0.0.1/product',
    'http://172.16.0.1/product',
    'http://192.168.1.1/product',
    'http://[::1]/product',
    'http://[fe80::1]/product',
    'http://[fc00::1]/product',
  ];

  for (const competitorUrl of blockedUrls) {
    assertBadRequest(
      () => parseCreateTargetBody({ competitorName: 'Store', competitorUrl }),
      /host is not allowed/
    );
  }

  assert.deepEqual(parseCreateTargetBody({
    competitorName: ' Local Fixture ',
    competitorUrl: 'http://127.0.0.1:9000/product',
  }, { allowPrivateUrls: true }), {
    competitorName: 'Local Fixture',
    competitorUrl: 'http://127.0.0.1:9000/product',
  });
});

test('target handlers use camelCase create/list/update/deactivation contracts', async () => {
  const savedTarget = {
    id: TARGET_ID,
    productId: PRODUCT_ID,
    competitorName: 'Store',
    competitorUrl: 'https://shop.example/p',
    isActive: true,
  };
  let createCall;
  const createResponse = await invokeHandler(createCreateCompetitorTargetHandler({
    createFn: async (productId, input) => {
      createCall = { productId, input };
      return savedTarget;
    },
  }), {
    params: { id: PRODUCT_ID },
    body: { competitorName: ' Store ', competitorUrl: 'https://shop.example/p' },
  });

  assert.deepEqual(createCall, {
    productId: PRODUCT_ID,
    input: { competitorName: 'Store', competitorUrl: 'https://shop.example/p' },
  });
  assert.deepEqual(createResponse, { statusCode: 201, body: { target: savedTarget } });

  const listResponse = await invokeHandler(createListCompetitorTargetsHandler({
    listFn: async (productId) => {
      assert.equal(productId, PRODUCT_ID);
      return [savedTarget];
    },
  }), { params: { id: PRODUCT_ID } });
  assert.deepEqual(listResponse, { statusCode: 200, body: { items: [savedTarget] } });

  let updateCall;
  const inactiveTarget = { ...savedTarget, isActive: false };
  const updateResponse = await invokeHandler(createUpdateCompetitorTargetHandler({
    updateFn: async (productId, targetId, changes) => {
      updateCall = { productId, targetId, changes };
      return inactiveTarget;
    },
  }), {
    params: { id: PRODUCT_ID, targetId: TARGET_ID },
    body: { competitorName: ' Store ', isActive: false },
  });

  assert.deepEqual(updateCall, {
    productId: PRODUCT_ID,
    targetId: TARGET_ID,
    changes: { competitorName: 'Store', isActive: false },
  });
  assert.deepEqual(updateResponse, { statusCode: 200, body: { target: inactiveTarget } });
});

test('target patch rejects empty, unknown, and incorrectly typed changes', () => {
  assertBadRequest(() => parsePatchTargetBody({}), /At least one field/);
  assertBadRequest(() => parsePatchTargetBody({ deleted: true }), /cannot be set/);
  assertBadRequest(() => parsePatchTargetBody({ competitorName: '  ' }), /required/);
  assertBadRequest(() => parsePatchTargetBody({ isActive: 'false' }), /boolean/);
});

test('global target handler validates useful filters and returns pagination', async () => {
  assert.deepEqual(parseGlobalTargetQuery({ active: 'false', page: '2', limit: '100' }), {
    page: 2,
    limit: 100,
    isActive: false,
  });
  assert.throws(() => parseGlobalTargetQuery({ active: 'all' }), /active must be true or false/);
  assert.throws(() => parseGlobalTargetQuery({ limit: '101' }), /between 1 and 100/);

  const result = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  const response = await invokeHandler(createListGlobalCompetitorTargetsHandler({
    listFn: async (query) => {
      assert.deepEqual(query, { page: 1, limit: 20, isActive: undefined });
      return result;
    },
  }), { query: {} });
  assert.deepEqual(response, { statusCode: 200, body: result });
});

test('competitor-target endpoints require JWT authentication', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  app.use(errorMiddleware);

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const port = server.address().port;
  const responses = await Promise.all([
    fetch(`http://127.0.0.1:${port}/api/products/${PRODUCT_ID}/competitor-targets`),
    fetch(`http://127.0.0.1:${port}/api/products/${PRODUCT_ID}/competitor-targets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        competitorName: 'Store',
        competitorUrl: 'https://shop.example/p',
      }),
    }),
    fetch(`http://127.0.0.1:${port}/api/products/${PRODUCT_ID}/competitor-targets/${TARGET_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    }),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.message, 'Missing or invalid authorization token');
  }
});
