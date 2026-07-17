import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.TRUST_PROXY = '1';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_GENERAL_MAX = '7';
process.env.RATE_LIMIT_AUTH_MAX = '3';
process.env.RATE_LIMIT_EXPENSIVE_MAX = '2';

const { default: productionApp } = await import('../src/app.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const {
  RATE_LIMIT_POLICIES,
  createRateLimiter,
} = await import('../src/middleware/rateLimit.middleware.js');
const { requestIdMiddleware } = await import('../src/middleware/requestId.middleware.js');
const { createRequestLogger } = await import('../src/middleware/requestLogger.middleware.js');

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function withServer(app, callback) {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });

  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('request ID middleware sets req.requestId and the response header', async () => {
  const app = express();
  let observedRequestId;

  app.use(requestIdMiddleware);
  app.get('/probe', (req, res) => {
    observedRequestId = req.requestId;
    res.json({ requestId: req.requestId });
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/probe`);
    const body = await response.json();
    const headerRequestId = response.headers.get('x-request-id');

    assert.equal(response.status, 200);
    assert.match(headerRequestId, UUID_REGEX);
    assert.equal(body.requestId, headerRequestId);
    assert.equal(observedRequestId, headerRequestId);
  });
});

test('centralized errors preserve existing fields and add the request ID', async () => {
  const app = express();

  app.use(requestIdMiddleware);
  app.get('/failure', (req, res, next) => {
    const error = new Error('Expected failure');
    error.statusCode = 418;
    next(error);
  });
  app.use(errorMiddleware);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/failure`);
    const body = await response.json();
    const requestId = response.headers.get('x-request-id');

    assert.equal(response.status, 418);
    assert.deepEqual(body, {
      error: {
        message: 'Expected failure',
        statusCode: 418,
        requestId,
      },
    });
  });
});

test('request logger receives the request ID without logging sensitive request data', () => {
  const messages = [];
  const times = [100, 137];
  const logger = createRequestLogger({
    log: (message) => messages.push(message),
    now: () => times.shift(),
  });
  const response = new EventEmitter();
  response.statusCode = 204;
  const request = {
    requestId: 'request-id-123',
    method: 'POST',
    path: '/safe-path',
    originalUrl: '/safe-path?accessToken=must-not-log',
    body: { password: 'must-not-log' },
    headers: { authorization: 'Bearer must-not-log' },
  };
  let nextCalled = false;

  logger(request, response, () => {
    nextCalled = true;
  });
  response.emit('finish');

  assert.equal(nextCalled, true);
  assert.deepEqual(messages, [
    'requestId=request-id-123 method=POST path=/safe-path status=204 durationMs=37',
  ]);
  assert.doesNotMatch(messages[0], /accessToken|password|authorization|Bearer|must-not-log/);
});

test('general, auth, and expensive policies use validated environment configuration', () => {
  assert.equal(productionApp.get('trust proxy'), 1);
  assert.deepEqual(RATE_LIMIT_POLICIES, {
    general: { windowMs: 60000, max: 7 },
    auth: { windowMs: 60000, max: 3 },
    expensive: { windowMs: 60000, max: 2 },
  });
});

test('limiters return consistent request-ID JSON and health stays unblocked', async (t) => {
  await t.test('health exclusion and general API limit', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    app.use('/api', createRateLimiter({ windowMs: 60000, max: 1 }));
    app.get('/api/probe', (req, res) => res.json({ status: 'ok' }));

    await withServer(app, async (baseUrl) => {
      const healthResponses = await Promise.all([
        fetch(`${baseUrl}/health`),
        fetch(`${baseUrl}/health`),
        fetch(`${baseUrl}/health`),
      ]);
      assert.deepEqual(healthResponses.map((response) => response.status), [200, 200, 200]);

      const firstApiResponse = await fetch(`${baseUrl}/api/probe`);
      const limitedResponse = await fetch(`${baseUrl}/api/probe`);
      const limitedBody = await limitedResponse.json();
      const requestId = limitedResponse.headers.get('x-request-id');

      assert.equal(firstApiResponse.status, 200);
      assert.equal(limitedResponse.status, 429);
      assert.deepEqual(limitedBody, {
        error: {
          message: 'Too many requests. Please try again later.',
          statusCode: 429,
          requestId,
        },
      });
    });
  });

  for (const scope of ['auth', 'expensive']) {
    await t.test(`${scope} limit`, async () => {
      const app = express();
      app.use(requestIdMiddleware);
      app.use(`/api/${scope}`, createRateLimiter({ windowMs: 60000, max: 1 }));
      app.get(`/api/${scope}/probe`, (req, res) => res.json({ status: 'ok' }));

      await withServer(app, async (baseUrl) => {
        const firstResponse = await fetch(`${baseUrl}/api/${scope}/probe`);
        const limitedResponse = await fetch(`${baseUrl}/api/${scope}/probe`);

        assert.equal(firstResponse.status, 200);
        assert.equal(limitedResponse.status, 429);
        assert.match(limitedResponse.headers.get('x-request-id'), UUID_REGEX);
        assert.equal((await limitedResponse.json()).error.statusCode, 429);
      });
    });
  }
});

test('invalid rate-limit and trust-proxy values fail during environment startup', async (t) => {
  const invalidValues = [
    ['RATE_LIMIT_WINDOW_MS', '0'],
    ['RATE_LIMIT_GENERAL_MAX', 'not-a-number'],
    ['RATE_LIMIT_AUTH_MAX', '-1'],
    ['RATE_LIMIT_EXPENSIVE_MAX', '1.5'],
    ['TRUST_PROXY', '11'],
  ];

  for (const [name, value] of invalidValues) {
    await t.test(name, () => {
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', "await import('./src/config/env.js')"],
        {
          cwd: API_ROOT,
          encoding: 'utf8',
          env: {
            ...process.env,
            JWT_ACCESS_SECRET: 'test-access-secret',
            JWT_REFRESH_SECRET: 'test-refresh-secret',
            [name]: value,
          },
        }
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(name));
    });
  }
});

test('the existing health response remains unchanged apart from the additive request ID', async () => {
  await withServer(productionApp, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-request-id'), UUID_REGEX);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      service: 'dynamic-pricing-api',
    });
  });
});
