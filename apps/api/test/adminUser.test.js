import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createListAdminUsersHandler,
  createUpdateAdminUserRoleHandler,
  parseAdminUserListQuery,
  parseRoleUpdateBody,
} = await import('../src/controllers/adminUser.controller.js');
const { listAdminUsers, updateAdminUserRole } = await import('../src/services/adminUser.service.js');
const { pool } = await import('../src/config/db.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { requestIdMiddleware } = await import('../src/middleware/requestId.middleware.js');
const { default: adminRoutes } = await import('../src/routes/admin.routes.js');
const { generateAccessToken } = await import('../src/utils/jwt.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    handler(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

test('admin user list filters and pagination are validated', () => {
  assert.deepEqual(parseAdminUserListQuery({ page: '2', limit: '100', role: 'manager' }), {
    page: 2,
    limit: 100,
    role: 'manager',
  });
  assert.deepEqual(parseAdminUserListQuery({}), { page: 1, limit: 20, role: undefined });
  assert.throws(() => parseAdminUserListQuery({ role: 'owner' }), /viewer, manager, or admin/);
  assert.throws(() => parseAdminUserListQuery({ limit: '101' }), /between 1 and 100/);
  assert.throws(() => parseAdminUserListQuery({ search: 'x' }), /Invalid query field/);
});

test('role body accepts exactly one supported role field', () => {
  assert.equal(parseRoleUpdateBody({ role: 'viewer' }), 'viewer');
  assert.throws(() => parseRoleUpdateBody({}), /only role/);
  assert.throws(() => parseRoleUpdateBody({ role: 'admin', isActive: true }), /only role/);
  assert.throws(() => parseRoleUpdateBody({ role: 'owner' }), /viewer, manager, or admin/);
  assert.throws(() => parseRoleUpdateBody(null), /JSON object/);
});

test('admin list service selects only safe fields with parameterized role and pagination', async () => {
  const calls = [];
  const safeUser = {
    id: USER_ID,
    name: 'User',
    email: 'user@example.com',
    role: 'manager',
    isActive: true,
    createdAt: '2026-07-17T00:00:00.000Z',
  };
  const result = await listAdminUsers({ page: 2, limit: 10, role: 'manager' }, {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return calls.length === 1 ? { rows: [{ total: 11 }] } : { rows: [safeUser] };
    },
  });

  assert.deepEqual(result, {
    items: [safeUser],
    pagination: { page: 2, limit: 10, total: 11, totalPages: 2 },
  });
  assert.deepEqual(calls[0].params, ['manager']);
  assert.deepEqual(calls[1].params, ['manager', 10, 10]);
  assert.match(calls[1].sql, /WHERE role = \$1/);
  assert.match(calls[1].sql, /is_active AS "isActive"/);
  assert.doesNotMatch(calls[1].sql, /password|refresh|token|secret/i);
});

test('role update is parameterized, active-only, safe, and rejects missing or inactive users', async () => {
  const calls = [];
  const updated = await updateAdminUserRole(USER_ID, 'admin', {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: USER_ID, name: 'User', email: 'user@example.com', role: 'admin', isActive: true, createdAt: '2026-07-17T00:00:00Z' }] };
    },
  });
  assert.equal(updated.role, 'admin');
  assert.deepEqual(calls[0].params, [USER_ID, 'admin']);
  assert.match(calls[0].sql, /SET role = \$2/);
  assert.match(calls[0].sql, /id = \$1[\s\S]*is_active = TRUE/);
  assert.doesNotMatch(calls[0].sql, /password|refresh|token|secret/i);

  await assert.rejects(
    updateAdminUserRole(USER_ID, 'viewer', { queryFn: async () => ({ rows: [] }) }),
    (error) => error.statusCode === 404 && error.message === 'Active user not found'
  );
});

test('handlers pass safe contracts and block the current admin before any update', async () => {
  const listResult = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  const listed = await invokeHandler(createListAdminUsersHandler({
    listFn: async (filters) => {
      assert.deepEqual(filters, { page: 1, limit: 20, role: undefined });
      return listResult;
    },
  }), { query: {} });
  assert.deepEqual(listed, { statusCode: 200, body: listResult });

  let updateCalled = false;
  await assert.rejects(
    invokeHandler(createUpdateAdminUserRoleHandler({
      updateFn: async () => { updateCalled = true; },
    }), {
      params: { id: ADMIN_ID },
      user: { id: ADMIN_ID, role: 'admin' },
      body: { role: 'viewer' },
    }),
    (error) => error.statusCode === 409 && /own role/.test(error.message)
  );
  assert.equal(updateCalled, false);

  const changed = await invokeHandler(createUpdateAdminUserRoleHandler({
    updateFn: async (id, role) => ({ id, role }),
  }), {
    params: { id: USER_ID },
    user: { id: ADMIN_ID, role: 'admin' },
    body: { role: 'manager' },
  });
  assert.deepEqual(changed, { statusCode: 200, body: { user: { id: USER_ID, role: 'manager' } } });
});

test('viewer and manager receive centralized 403 with requestId and missing auth remains 401', async (t) => {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use(errorMiddleware);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const originalQuery = pool.query;

  try {
    for (const role of ['viewer', 'manager']) {
      const databaseUser = {
        id: USER_ID,
        name: 'User',
        email: 'user@example.com',
        role,
        is_active: true,
      };
      pool.query = async () => ({ rowCount: 1, rows: [databaseUser] });
      const token = generateAccessToken(databaseUser);
      const response = await fetch(`${baseUrl}/api/admin/users`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const requestId = response.headers.get('x-request-id');
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        error: { message: 'Insufficient permissions', statusCode: 403, requestId },
      });
    }

    const missing = await fetch(`${baseUrl}/api/admin/users`);
    assert.equal(missing.status, 401);
  } finally {
    pool.query = originalQuery;
  }
});
