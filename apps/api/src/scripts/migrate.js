import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Client } = pg;
const MIGRATION_LOCK_ID = '746621379101';
const defaultMigrationsDirectory = fileURLToPath(
  new URL('../../../../database/migrations/', import.meta.url)
);

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL;

  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('DATABASE_URL is required for migrations.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  return value;
}

async function listMigrationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

async function assertSafeMigrationBaseline(client) {
  const tracker = await client.query(
    `SELECT to_regclass('public.schema_migrations') AS relation`
  );

  if (tracker.rows[0]?.relation) return;

  const existingTables = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );

  if (existingTables.rowCount > 0) {
    throw new Error(
      'Refusing to initialize migration tracking on a non-empty legacy database. '
      + 'Create an explicit reviewed baseline before using this runner.'
    );
  }

  await client.query(
    `CREATE TABLE public.schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`
  );
}

async function applyMigration(client, directory, filename) {
  const sql = await readFile(path.join(directory, filename), 'utf8');

  if (!sql.trim()) {
    throw new Error(`Migration ${filename} is empty.`);
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function runMigrations({
  databaseUrl = requireDatabaseUrl(),
  migrationsDirectory = process.env.MIGRATIONS_DIR || defaultMigrationsDirectory,
  logger = console,
} = {}) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID]);
    await assertSafeMigrationBaseline(client);

    const filenames = await listMigrationFiles(migrationsDirectory);
    const appliedResult = await client.query(
      'SELECT filename FROM public.schema_migrations ORDER BY filename'
    );
    const applied = new Set(appliedResult.rows.map((row) => row.filename));
    const pending = filenames.filter((filename) => !applied.has(filename));

    for (const filename of pending) {
      logger.log(`Applying migration ${filename}`);
      await applyMigration(client, migrationsDirectory, filename);
    }

    logger.log(pending.length === 0
      ? 'No pending migrations.'
      : `Applied ${pending.length} migration(s).`);
    return pending;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID])
      .catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch((error) => {
    console.error(`Migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}
