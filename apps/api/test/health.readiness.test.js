import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const { createReadinessHandler } = await import('../src/controllers/health.controller.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { requestIdMiddleware } = await import('../src/middleware/requestId.middleware.js');
const { checkDatabaseReadiness } = await import('../src/services/health.service.js');

async function withServer(handler, callback) {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/health/ready', handler);
  app.use(errorMiddleware);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('database readiness uses one minimal PostgreSQL query', async () => {
  const calls = [];
  await checkDatabaseReadiness({
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ ready: 1 }] };
    },
  });

  assert.deepEqual(calls, [{ sql: 'SELECT 1 AS ready', params: undefined }]);
});

test('database readiness is bounded when PostgreSQL does not respond', async () => {
  await assert.rejects(
    checkDatabaseReadiness({
      queryFn: async () => new Promise(() => {}),
      timeoutMs: 5,
    }),
    /timed out/
  );
});

test('readiness returns 200 only after the database check succeeds', async () => {
  await withServer(createReadinessHandler({ checkDatabaseFn: async () => {} }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ready',
      service: 'dynamic-pricing-api',
      database: 'ready',
    });
  });
});

test('readiness sanitizes PostgreSQL failures as request-ID 503 responses', async () => {
  await withServer(createReadinessHandler({
    checkDatabaseFn: async () => {
      throw new Error('password authentication failed for postgresql://secret');
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.error.statusCode, 503);
    assert.equal(body.error.message, 'Service unavailable');
    assert.equal(body.error.requestId, response.headers.get('x-request-id'));
    assert.equal(JSON.stringify(body).includes('secret'), false);
    assert.equal(JSON.stringify(body).includes('postgresql'), false);
  });
});
