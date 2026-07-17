import crypto from 'node:crypto';

import bcrypt from 'bcrypt';

import { pool, query } from '../config/db.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt.js';

const SALT_ROUNDS = 10;
const PUBLIC_REGISTRATION_ROLE = 'viewer';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function invalidRefreshSession() {
  return createError('Invalid refresh session', 401);
}

function sanitizeUser(user) {
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

function getRefreshExpiry(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);

  if (!Number.isInteger(payload.exp)) {
    throw new Error('Refresh token expiry is missing');
  }

  return new Date(payload.exp * 1000);
}

export function hashRefreshToken(refreshToken) {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

async function createRefreshSession(user, queryFn) {
  const sessionId = crypto.randomUUID();
  const refreshToken = generateRefreshToken(user, sessionId);
  const refreshExpiresAt = getRefreshExpiry(refreshToken);
  const refreshTokenHash = hashRefreshToken(refreshToken);

  await queryFn(
    `INSERT INTO auth_sessions (
       id,
       user_id,
       refresh_token_hash,
       expires_at
     )
     VALUES ($1, $2, $3, $4)`,
    [sessionId, user.id, refreshTokenHash, refreshExpiresAt]
  );

  return { refreshToken, refreshExpiresAt };
}

function createAuthResult(user, refreshSession) {
  return {
    user,
    accessToken: generateAccessToken(user),
    ...refreshSession,
  };
}

export async function findUserById(id, { queryFn = query } = {}) {
  const result = await queryFn(
    `SELECT id, name, email, role, is_active, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

export async function createUser(
  { name, email, password },
  { queryFn = query, hashPasswordFn = bcrypt.hash } = {}
) {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await queryFn(
    'SELECT id FROM users WHERE email = $1',
    [normalizedEmail]
  );

  if (existingUser.rowCount > 0) {
    throw createError('Email already exists', 409);
  }

  const passwordHash = await hashPasswordFn(password, SALT_ROUNDS);

  try {
    const result = await queryFn(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at, updated_at`,
      [normalizedName, normalizedEmail, passwordHash, PUBLIC_REGISTRATION_ROLE]
    );

    const user = result.rows[0];
    const refreshSession = await createRefreshSession(user, queryFn);

    return createAuthResult(user, refreshSession);
  } catch (error) {
    if (error.code === '23505') {
      throw createError('Email already exists', 409);
    }

    throw error;
  }
}

export async function loginUser(
  { email, password },
  { queryFn = query, comparePasswordFn = bcrypt.compare } = {}
) {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await queryFn(
    `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  const user = result.rows[0];

  if (!user || !user.is_active) {
    throw createError('Invalid email or password', 401);
  }

  const isPasswordValid = await comparePasswordFn(password, user.password_hash);

  if (!isPasswordValid) {
    throw createError('Invalid email or password', 401);
  }

  const safeUser = sanitizeUser(user);
  const refreshSession = await createRefreshSession(safeUser, queryFn);

  return createAuthResult(safeUser, refreshSession);
}

export async function rotateRefreshSession(
  refreshToken,
  {
    connectFn = () => pool.connect(),
    now = () => new Date(),
  } = {}
) {
  let payload;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalidRefreshSession();
  }

  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw invalidRefreshSession();
  }

  const client = await connectFn();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const sessionResult = await client.query(
      `SELECT
         s.id,
         s.user_id,
         s.expires_at,
         s.revoked_at,
         u.name,
         u.email,
         u.role,
         u.is_active,
         u.created_at,
         u.updated_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1
         AND s.user_id = $2
         AND s.refresh_token_hash = $3
       FOR UPDATE OF s`,
      [payload.jti, payload.sub, hashRefreshToken(refreshToken)]
    );
    const session = sessionResult.rows[0];

    if (
      !session
      || session.revoked_at
      || !session.is_active
      || new Date(session.expires_at).getTime() <= now().getTime()
    ) {
      throw invalidRefreshSession();
    }

    const revokeResult = await client.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW(), used_at = NOW()
       WHERE id = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [session.id]
    );

    if (revokeResult.rowCount !== 1) {
      throw invalidRefreshSession();
    }

    const user = {
      id: session.user_id,
      name: session.name,
      email: session.email,
      role: session.role,
      is_active: session.is_active,
      created_at: session.created_at,
      updated_at: session.updated_at,
    };
    const rotatedSession = await createRefreshSession(user, client.query.bind(client));
    const accessToken = generateAccessToken(user);

    await client.query('COMMIT');
    return { accessToken, ...rotatedSession };
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRefreshSession(
  refreshToken,
  { queryFn = query } = {}
) {
  if (typeof refreshToken !== 'string' || !refreshToken) return false;

  const result = await queryFn(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE refresh_token_hash = $1
     RETURNING id`,
    [hashRefreshToken(refreshToken)]
  );

  return result.rowCount > 0;
}
