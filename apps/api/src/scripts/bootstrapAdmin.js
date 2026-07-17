import bcrypt from 'bcrypt';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from '../config/db.js';

const SALT_ROUNDS = 10;
const BOOTSTRAP_LOCK_ID = '746621379102';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBootstrapInput(environment) {
  const name = environment.BOOTSTRAP_ADMIN_NAME?.trim() || '';
  const email = environment.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || '';
  const password = environment.BOOTSTRAP_ADMIN_PASSWORD || '';

  if (!name || name.length > 100) {
    throw new Error('BOOTSTRAP_ADMIN_NAME must be between 1 and 100 characters.');
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 255) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
  }
  if (password.length < 12 || password.length > 72) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be between 12 and 72 characters.');
  }
  if (
    !/[a-z]/.test(password)
    || !/[A-Z]/.test(password)
    || !/[0-9]/.test(password)
    || !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD must include upper, lower, numeric, and symbol characters.'
    );
  }

  return { name, email, password };
}

export async function bootstrapFirstAdmin({
  environment = process.env,
  connectFn = () => pool.connect(),
  hashPasswordFn = bcrypt.hash,
  logger = console,
} = {}) {
  const client = await connectFn();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query(
      'SELECT pg_advisory_xact_lock($1::bigint)',
      [BOOTSTRAP_LOCK_ID]
    );
    const adminResult = await client.query(
      `SELECT id
       FROM users
       WHERE role = 'admin'
       LIMIT 1`
    );

    if (adminResult.rowCount > 0) {
      await client.query('COMMIT');
      logger.log('An admin already exists; no account was changed.');
      return { created: false };
    }

    const { name, email, password } = validateBootstrapInput(environment);
    const emailResult = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (emailResult.rowCount > 0) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL already belongs to an existing account.');
    }

    const passwordHash = await hashPasswordFn(password, SALT_ROUNDS);
    const insertResult = await client.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, email`,
      [name, email, passwordHash]
    );

    await client.query('COMMIT');
    logger.log(`Created first admin account for ${insertResult.rows[0].email}.`);
    return { created: true, id: insertResult.rows[0].id };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrapFirstAdmin().catch((error) => {
    console.error(`Admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}
