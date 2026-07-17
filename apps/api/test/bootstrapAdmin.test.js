import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const { bootstrapFirstAdmin } = await import('../src/scripts/bootstrapAdmin.js');

function createClient({ adminExists = false, emailExists = false } = {}) {
  const calls = [];
  const client = {
    calls,
    released: false,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/WHERE role = 'admin'/.test(sql)) {
        return { rowCount: adminExists ? 1 : 0, rows: adminExists ? [{ id: 'admin-id' }] : [] };
      }
      if (/SELECT id FROM users WHERE email/.test(sql)) {
        return { rowCount: emailExists ? 1 : 0, rows: emailExists ? [{ id: 'user-id' }] : [] };
      }
      if (/INSERT INTO users/.test(sql)) {
        return { rowCount: 1, rows: [{ id: 'new-admin-id', email: params[1] }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() { this.released = true; },
  };
  return client;
}

const validEnvironment = {
  BOOTSTRAP_ADMIN_NAME: ' First Admin ',
  BOOTSTRAP_ADMIN_EMAIL: ' ADMIN@example.com ',
  BOOTSTRAP_ADMIN_PASSWORD: 'StrongPassword!123',
};

test('first-admin bootstrap inserts one parameterized admin without printing or storing the password', async () => {
  const client = createClient();
  const messages = [];
  const result = await bootstrapFirstAdmin({
    environment: validEnvironment,
    connectFn: async () => client,
    hashPasswordFn: async (password, rounds) => {
      assert.equal(password, validEnvironment.BOOTSTRAP_ADMIN_PASSWORD);
      assert.equal(rounds, 10);
      return 'bcrypt-password-hash';
    },
    logger: { log: (message) => messages.push(message) },
  });
  const insertCall = client.calls.find(({ sql }) => /INSERT INTO users/.test(sql));

  assert.deepEqual(result, { created: true, id: 'new-admin-id' });
  assert.match(insertCall.sql, /VALUES \(\$1, \$2, \$3, 'admin'\)/);
  assert.deepEqual(insertCall.params, [
    'First Admin',
    'admin@example.com',
    'bcrypt-password-hash',
  ]);
  assert.equal(JSON.stringify(client.calls).includes(validEnvironment.BOOTSTRAP_ADMIN_PASSWORD), false);
  assert.equal(messages.join(' ').includes(validEnvironment.BOOTSTRAP_ADMIN_PASSWORD), false);
  assert.equal(client.released, true);
});

test('existing admin exits safely before reading credentials or changing accounts', async () => {
  const client = createClient({ adminExists: true });
  const messages = [];
  const result = await bootstrapFirstAdmin({
    environment: {},
    connectFn: async () => client,
    hashPasswordFn: async () => { throw new Error('must not hash'); },
    logger: { log: (message) => messages.push(message) },
  });

  assert.deepEqual(result, { created: false });
  assert.equal(client.calls.some(({ sql }) => /INSERT INTO users/.test(sql)), false);
  assert.match(messages[0], /already exists/i);
});

test('bootstrap rejects weak credentials and existing non-admin email without elevation', async (t) => {
  await t.test('weak password', async () => {
    const client = createClient();
    await assert.rejects(
      bootstrapFirstAdmin({
        environment: { ...validEnvironment, BOOTSTRAP_ADMIN_PASSWORD: 'weakpassword' },
        connectFn: async () => client,
        logger: { log: () => {} },
      }),
      /upper, lower, numeric, and symbol/
    );
    assert.equal(client.calls.some(({ sql }) => /INSERT INTO users/.test(sql)), false);
  });

  await t.test('invalid email', async () => {
    const client = createClient();
    await assert.rejects(
      bootstrapFirstAdmin({
        environment: { ...validEnvironment, BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' },
        connectFn: async () => client,
        logger: { log: () => {} },
      }),
      /valid email address/
    );
  });

  await t.test('existing viewer email', async () => {
    const client = createClient({ emailExists: true });
    await assert.rejects(
      bootstrapFirstAdmin({
        environment: validEnvironment,
        connectFn: async () => client,
        logger: { log: () => {} },
      }),
      /already belongs to an existing account/
    );
    assert.equal(client.calls.some(({ sql }) => /UPDATE users/.test(sql)), false);
    assert.equal(client.calls.some(({ sql }) => /INSERT INTO users/.test(sql)), false);
  });
});
