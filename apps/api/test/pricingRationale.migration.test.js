import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../database/migrations/005_rename_claude_rationale_to_ai_rationale.sql',
  import.meta.url
);

test('rationale migration renames the existing column without replacing or converting it', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(
    sql,
    /ALTER TABLE price_suggestions\s+RENAME COLUMN claude_rationale TO ai_rationale;/i
  );
  assert.doesNotMatch(sql, /ADD\s+COLUMN|DROP\s+COLUMN|ALTER\s+COLUMN|TYPE\s+JSONB/i);
});
