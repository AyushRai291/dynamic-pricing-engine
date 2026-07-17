import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('auth session migration stores only token hashes and leaves users unchanged', async () => {
  const migrationPath = path.resolve(
    API_ROOT,
    '../../database/migrations/007_create_auth_sessions_table.sql'
  );
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE auth_sessions/i);
  assert.match(sql, /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /refresh_token_hash CHAR\(64\) NOT NULL UNIQUE/i);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/i);
  assert.match(sql, /revoked_at TIMESTAMPTZ/i);
  assert.match(sql, /created_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  assert.match(sql, /used_at TIMESTAMPTZ/i);
  assert.match(sql, /WHERE revoked_at IS NULL/i);
  assert.doesNotMatch(sql, /\brefresh_token\s+(?:TEXT|VARCHAR)/i);
  assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT INTO|DELETE FROM)\s+users\b/i);
});
