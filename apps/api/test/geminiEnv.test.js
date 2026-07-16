import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
process.env.GEMINI_API_KEY = '';

const { default: app } = await import('../src/app.js');

const execFileAsync = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));

async function importEnv(overrides, source) {
  return execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', source],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        JWT_ACCESS_SECRET: 'test-access-secret',
        JWT_REFRESH_SECRET: 'test-refresh-secret',
        ...overrides,
      },
    }
  );
}

test('Gemini defaults import without an API key', async () => {
  const { stdout } = await importEnv(
    {
      GEMINI_API_KEY: '',
      GEMINI_MODEL: 'gemini-2.5-flash-lite',
      GEMINI_REQUEST_TIMEOUT_MS: '10000',
      GEMINI_MAX_OUTPUT_TOKENS: '600',
    },
    `const env = await import('./src/config/env.js');
     console.log(JSON.stringify({
       configured: env.GEMINI_API_KEY !== null,
       model: env.GEMINI_MODEL,
       timeout: env.GEMINI_REQUEST_TIMEOUT_MS,
       tokens: env.GEMINI_MAX_OUTPUT_TOKENS,
     }));`
  );

  assert.deepEqual(JSON.parse(stdout), {
    configured: false,
    model: 'gemini-2.5-flash-lite',
    timeout: 10000,
    tokens: 600,
  });
});

test('health remains available when Gemini is not configured', async (t) => {
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'dynamic-pricing-api',
  });
});

test('Gemini model, timeout, and token configuration reject unsafe values', async (t) => {
  const cases = [
    ['empty model', { GEMINI_MODEL: ' ' }, /GEMINI_MODEL must be a non-empty string/],
    ['zero timeout', { GEMINI_REQUEST_TIMEOUT_MS: '0' }, /between 1 and 60000/],
    ['excessive timeout', { GEMINI_REQUEST_TIMEOUT_MS: '60001' }, /between 1 and 60000/],
    ['zero tokens', { GEMINI_MAX_OUTPUT_TOKENS: '0' }, /between 1 and 8192/],
    ['excessive tokens', { GEMINI_MAX_OUTPUT_TOKENS: '8193' }, /between 1 and 8192/],
  ];

  for (const [name, overrides, pattern] of cases) {
    await t.test(name, async () => {
      await assert.rejects(
        importEnv(overrides, `await import('./src/config/env.js');`),
        (error) => {
          assert.match(error.stderr, pattern);
          return true;
        }
      );
    });
  }
});
