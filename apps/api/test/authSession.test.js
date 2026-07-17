import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createLoginHandler,
  createLogoutHandler,
  createRefreshHandler,
  createRegisterHandler,
} = await import('../src/controllers/auth.controller.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { requestIdMiddleware } = await import('../src/middleware/requestId.middleware.js');
const {
  createUser,
  hashRefreshToken,
  loginUser,
  revokeRefreshSession,
  rotateRefreshSession,
} = await import('../src/services/auth.service.js');
const {
  getRefreshCookieClearOptions,
  getRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
} = await import('../src/utils/authCookie.js');
const {
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = await import('../src/utils/jwt.js');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

function user(overrides = {}) {
  return {
    id: USER_ID,
    name: 'Current User',
    email: 'current@example.com',
    role: 'manager',
    is_active: true,
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function createTestApp(path, handler) {
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.post(path, handler);
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

test('login and registration return access data and set refresh tokens only in HttpOnly cookies', async () => {
  for (const [path, statusCode, handler] of [
    ['/login', 200, createLoginHandler],
    ['/register', 201, createRegisterHandler],
  ]) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const authResult = {
      user: user({ role: path === '/register' ? 'viewer' : 'manager' }),
      accessToken: 'access-token',
      refreshToken: 'refresh.token.value',
      refreshExpiresAt: expiresAt,
    };
    const dependency = path === '/login'
      ? { loginUserFn: async () => authResult }
      : { createUserFn: async () => authResult };

    await withServer(createTestApp(path, handler(dependency)), async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(path === '/login'
          ? { email: 'user@example.com', password: 'password' }
          : { name: 'User', email: 'user@example.com', password: 'password' }),
      });
      const body = await response.json();
      const cookie = response.headers.get('set-cookie');

      assert.equal(response.status, statusCode);
      assert.deepEqual(body, { user: authResult.user, accessToken: 'access-token' });
      assert.equal('refreshToken' in body, false);
      assert.match(cookie, new RegExp(`^${REFRESH_COOKIE_NAME}=refresh\.token\.value`));
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\/api\/auth/i);
      assert.match(cookie, /Max-Age=/i);
      assert.doesNotMatch(cookie, /Secure/i);
    });
  }

  const secureOptions = getRefreshCookieOptions(
    new Date(Date.now() + 60_000),
    { production: true }
  );
  assert.equal(secureOptions.secure, true);
  assert.deepEqual(getRefreshCookieClearOptions({ production: true }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/api/auth',
  });
});

test('registration stays viewer-only and login creates independent hash-only sessions', async () => {
  const registrationCalls = [];
  const registeredUser = user({ role: 'viewer' });
  const registration = await createUser({
    name: ' New User ',
    email: ' NEW@example.com ',
    password: 'StrongPassword!1',
  }, {
    hashPasswordFn: async () => 'password-hash',
    queryFn: async (sql, params) => {
      registrationCalls.push({ sql, params });
      if (/SELECT id FROM users WHERE email/.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO users/.test(sql)) return { rowCount: 1, rows: [registeredUser] };
      return { rowCount: 1, rows: [] };
    },
  });

  assert.equal(registration.user.role, 'viewer');
  assert.equal(registrationCalls[1].params[3], 'viewer');
  const registrationSessionParams = registrationCalls[2].params;
  assert.match(registrationSessionParams[2], /^[0-9a-f]{64}$/);
  assert.notEqual(registrationSessionParams[2], registration.refreshToken);

  const storedSessions = [];
  const loginQuery = async (sql, params) => {
    if (/FROM users/.test(sql)) {
      return {
        rowCount: 1,
        rows: [{ ...user(), password_hash: 'password-hash' }],
      };
    }
    storedSessions.push(params);
    return { rowCount: 1, rows: [] };
  };
  const first = await loginUser({ email: 'current@example.com', password: 'password' }, {
    queryFn: loginQuery,
    comparePasswordFn: async () => true,
  });
  const second = await loginUser({ email: 'current@example.com', password: 'password' }, {
    queryFn: loginQuery,
    comparePasswordFn: async () => true,
  });

  assert.notEqual(first.refreshToken, second.refreshToken);
  assert.notEqual(storedSessions[0][0], storedSessions[1][0]);
  assert.notEqual(storedSessions[0][2], storedSessions[1][2]);
  assert.equal(storedSessions.flat().includes(first.refreshToken), false);
  assert.equal(storedSessions.flat().includes(second.refreshToken), false);
});

function createRotationClient({ revokedAt = null, active = true, expiresAt } = {}) {
  const calls = [];
  const client = {
    calls,
    released: false,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT\s+s\.id/.test(sql)) {
        return {
          rowCount: 1,
          rows: [{
            ...user({
              email: 'database@example.com',
              role: 'admin',
              is_active: active,
            }),
            id: SESSION_ID,
            user_id: USER_ID,
            expires_at: expiresAt || new Date(Date.now() + 60_000),
            revoked_at: revokedAt,
          }],
        };
      }
      if (/UPDATE auth_sessions/.test(sql)) return { rowCount: 1, rows: [{ id: SESSION_ID }] };
      if (/INSERT INTO auth_sessions/.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() { this.released = true; },
  };
  return client;
}

test('refresh rotation revokes once, uses current database identity, and stores only the new hash', async () => {
  const initialToken = generateRefreshToken(user(), SESSION_ID);
  const client = createRotationClient();
  const result = await rotateRefreshSession(initialToken, {
    connectFn: async () => client,
  });
  const accessPayload = verifyAccessToken(result.accessToken);
  const rotatedPayload = verifyRefreshToken(result.refreshToken);

  assert.equal(accessPayload.email, 'database@example.com');
  assert.equal(accessPayload.role, 'admin');
  assert.equal(rotatedPayload.sub, USER_ID);
  assert.notEqual(rotatedPayload.jti, SESSION_ID);
  assert.equal(client.calls.some(({ sql }) => /used_at = NOW\(\)/.test(sql)), true);
  const insertCall = client.calls.find(({ sql }) => /INSERT INTO auth_sessions/.test(sql));
  assert.match(insertCall.params[2], /^[0-9a-f]{64}$/);
  assert.equal(insertCall.params.includes(result.refreshToken), false);
  assert.equal(client.calls.flatMap(({ params = [] }) => params).includes(initialToken), false);
  assert.equal(client.released, true);
});

test('replayed, expired, inactive-user, and malformed refresh tokens are rejected', async (t) => {
  const token = generateRefreshToken(user(), SESSION_ID);
  const cases = [
    ['replayed', { revokedAt: new Date() }],
    ['expired session', { expiresAt: new Date(Date.now() - 1_000) }],
    ['inactive user', { active: false }],
  ];

  for (const [name, options] of cases) {
    await t.test(name, async () => {
      const client = createRotationClient(options);
      await assert.rejects(
        rotateRefreshSession(token, { connectFn: async () => client }),
        (error) => error.statusCode === 401 && error.message === 'Invalid refresh session'
      );
      assert.equal(client.calls.some(({ sql }) => /INSERT INTO auth_sessions/.test(sql)), false);
      assert.equal(client.calls.some(({ sql }) => sql === 'ROLLBACK'), true);
    });
  }

  let connected = false;
  await assert.rejects(
    rotateRefreshSession('malformed', {
      connectFn: async () => { connected = true; },
    }),
    (error) => error.statusCode === 401 && error.message === 'Invalid refresh session'
  );
  assert.equal(connected, false);
});

test('refresh failures clear the cookie and logout is idempotent with hash-only revocation', async () => {
  const refreshHandler = createRefreshHandler({
    rotateFn: async () => {
      const error = new Error('Invalid refresh session');
      error.statusCode = 401;
      throw error;
    },
  });

  await withServer(createTestApp('/refresh', refreshHandler), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/refresh`, {
      method: 'POST',
      headers: { cookie: `${REFRESH_COOKIE_NAME}=replayed.token` },
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
    assert.equal((await response.json()).error.message, 'Invalid refresh session');
  });

  let revokedToken;
  const logoutHandler = createLogoutHandler({
    revokeFn: async (token) => { revokedToken = token; },
  });
  await withServer(createTestApp('/logout', logoutHandler), async (baseUrl) => {
    const first = await fetch(`${baseUrl}/logout`, {
      method: 'POST',
      headers: { cookie: `${REFRESH_COOKIE_NAME}=stored.token` },
    });
    const second = await fetch(`${baseUrl}/logout`, { method: 'POST' });
    assert.equal(first.status, 204);
    assert.equal(second.status, 204);
    assert.equal(revokedToken, 'stored.token');
    assert.match(first.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
    assert.match(second.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i);
  });

  let revokeParams;
  assert.equal(await revokeRefreshSession('stored.token', {
    queryFn: async (sql, params) => {
      assert.match(sql, /UPDATE auth_sessions/);
      revokeParams = params;
      return { rowCount: 1, rows: [{ id: SESSION_ID }] };
    },
  }), true);
  assert.deepEqual(revokeParams, [hashRefreshToken('stored.token')]);
  assert.equal(revokeParams.includes('stored.token'), false);
});
