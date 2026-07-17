import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const { pool } = await import('../src/config/db.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { authMiddleware } = await import('../src/middleware/auth.middleware.js');
const { requestIdMiddleware } = await import('../src/middleware/requestId.middleware.js');
const {
  requireManagerOrAdmin,
} = await import('../src/middleware/role.middleware.js');
const { default: authRoutes } = await import('../src/routes/auth.routes.js');
const { default: competitorTargetRoutes } = await import('../src/routes/competitorTarget.routes.js');
const { default: pricingRoutes } = await import('../src/routes/pricing.routes.js');
const { default: productRoutes } = await import('../src/routes/product.routes.js');
const { default: scraperRoutes } = await import('../src/routes/scraper.routes.js');
const {
  generateAccessToken,
  verifyAccessToken,
} = await import('../src/utils/jwt.js');

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createTestApp({ auth = false, pricing = false, products = false, scraper = false } = {}) {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());

  if (auth) app.use('/api/auth', authRoutes);
  if (products) app.use('/api/products', productRoutes);
  if (scraper) app.use('/api/scraper', scraperRoutes);
  if (pricing) app.use('/api/pricing', pricingRoutes);

  app.use(errorMiddleware);
  return app;
}

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

async function withPoolQuery(queryFn, callback) {
  const originalQuery = pool.query;
  pool.query = queryFn;

  try {
    return await callback();
  } finally {
    pool.query = originalQuery;
  }
}

function databaseUser(role) {
  return {
    id: USER_ID,
    name: 'Test User',
    email: 'user@example.com',
    role,
    is_active: true,
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
  };
}

test('viewer can use an authenticated GET and the database role overrides the JWT role', async () => {
  const viewer = databaseUser('viewer');
  const token = generateAccessToken({ ...viewer, role: 'admin' });
  assert.equal(verifyAccessToken(token).role, 'admin');

  await withPoolQuery(async (sql, params) => {
    assert.match(sql, /FROM users\s+WHERE id = \$1/);
    assert.deepEqual(params, [USER_ID]);
    return { rowCount: 1, rows: [viewer] };
  }, async () => {
    await withServer(createTestApp({ auth: true }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { user: viewer });
    });
  });
});

test('viewer receives centralized 403 errors for product, scraper, and pricing mutations', async () => {
  const viewer = databaseUser('viewer');
  const token = generateAccessToken({ ...viewer, role: 'admin' });
  const app = createTestApp({ pricing: true, products: true, scraper: true });

  await withPoolQuery(
    async () => ({ rowCount: 1, rows: [viewer] }),
    async () => {
      await withServer(app, async (baseUrl) => {
        const responses = await Promise.all([
          fetch(`${baseUrl}/api/products`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: '{}',
          }),
          fetch(`${baseUrl}/api/scraper/trigger`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: '{}',
          }),
          fetch(`${baseUrl}/api/scraper/jobs/job-1/retry`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: '{}',
          }),
          fetch(`${baseUrl}/api/pricing/score/${PRODUCT_ID}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: '{}',
          }),
        ]);

        for (const response of responses) {
          const requestId = response.headers.get('x-request-id');

          assert.equal(response.status, 403);
          assert.match(requestId, UUID_REGEX);
          assert.deepEqual(await response.json(), {
            error: {
              message: 'Insufficient permissions',
              statusCode: 403,
              requestId,
            },
          });
        }
      });
    }
  );
});

test('manager and admin pass the shared role middleware', () => {
  for (const role of ['manager', 'admin']) {
    let nextError = 'not called';

    requireManagerOrAdmin({ user: { role } }, {}, (error) => {
      nextError = error;
    });

    assert.equal(nextError, undefined);
  }
});

test('missing authentication remains a centralized 401', async () => {
  await withServer(createTestApp({ products: true }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const requestId = response.headers.get('x-request-id');

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: {
        message: 'Missing or invalid authorization token',
        statusCode: 401,
        requestId,
      },
    });
  });
});

test('public registration ignores an injected role and creates a viewer', async () => {
  let insertQuery;
  let insertParams;
  const viewer = databaseUser('viewer');

  await withPoolQuery(async (sql, params) => {
    if (/SELECT id FROM users WHERE email/.test(sql)) {
      return { rowCount: 0, rows: [] };
    }

    insertQuery = sql;
    insertParams = params;
    return { rowCount: 1, rows: [viewer] };
  }, async () => {
    await withServer(createTestApp({ auth: true }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: ' Test User ',
          email: ' USER@example.com ',
          password: 'safe-test-password',
          role: 'admin',
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.user.role, 'viewer');
      assert.equal(verifyAccessToken(body.accessToken).role, 'viewer');
    });
  });

  assert.match(insertQuery, /INSERT INTO users \(name, email, password_hash, role\)/);
  assert.equal(insertParams[0], 'Test User');
  assert.equal(insertParams[1], 'user@example.com');
  assert.equal(insertParams[3], 'viewer');
});

test('role migration changes only the users role default', async () => {
  const migrationPath = path.resolve(
    API_ROOT,
    '../../database/migrations/006_set_users_default_role_to_viewer.sql'
  );
  const sql = (await readFile(migrationPath, 'utf8')).trim();

  assert.match(
    sql,
    /^ALTER TABLE users\s+ALTER COLUMN role SET DEFAULT 'viewer';$/i
  );
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE)\b/i);
});

test('every operational mutation is wired after auth with the manager/admin guard', () => {
  const expectedMutations = [
    [productRoutes, 'post', '/'],
    [productRoutes, 'patch', '/:id'],
    [productRoutes, 'post', '/:id/sales/bulk'],
    [productRoutes, 'post', '/:id/competitor-targets'],
    [productRoutes, 'patch', '/:id/competitor-targets/:targetId'],
    [scraperRoutes, 'post', '/trigger'],
    [scraperRoutes, 'post', '/jobs/:jobId/retry'],
    [pricingRoutes, 'post', '/score/:productId'],
    [pricingRoutes, 'post', '/products/:id/suggestions'],
    [pricingRoutes, 'post', '/suggestions/:id/rationale'],
    [pricingRoutes, 'post', '/suggestions/:id/approve'],
    [pricingRoutes, 'post', '/suggestions/:id/reject'],
  ];

  for (const [router, method, routePath] of expectedMutations) {
    const authIndex = router.stack.findIndex((layer) => layer.handle === authMiddleware);
    const routeIndex = router.stack.findIndex((layer) => (
      layer.route?.path === routePath && layer.route.methods[method]
    ));
    const routeLayer = router.stack[routeIndex];

    assert.ok(authIndex >= 0, `${method.toUpperCase()} ${routePath} is missing authentication`);
    assert.ok(routeIndex > authIndex, `${method.toUpperCase()} ${routePath} runs before authentication`);
    assert.ok(
      routeLayer.route.stack.some((layer) => layer.handle === requireManagerOrAdmin),
      `${method.toUpperCase()} ${routePath} is missing manager/admin authorization`
    );
  }

  for (const router of [productRoutes, scraperRoutes, pricingRoutes, competitorTargetRoutes]) {
    const authIndex = router.stack.findIndex((layer) => layer.handle === authMiddleware);
    assert.ok(authIndex >= 0, 'router is missing authentication');
    const getRoutes = router.stack.filter((layer) => layer.route?.methods.get);

    for (const routeLayer of getRoutes) {
      assert.equal(
        routeLayer.route.stack.some((layer) => layer.handle === requireManagerOrAdmin),
        false,
        `GET ${routeLayer.route.path} must remain available to viewers`
      );
    }
  }
});
