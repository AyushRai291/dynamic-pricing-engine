import bcrypt from 'bcrypt';

import { query } from '../config/db.js';
import { generateTokens } from '../utils/jwt.js';

const SALT_ROUNDS = 10;
const PUBLIC_REGISTRATION_ROLE = 'viewer';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeUser(user) {
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export async function findUserById(id) {
  const result = await query(
    `SELECT id, name, email, role, is_active, created_at, updated_at
     FROM users
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

export async function createUser({ name, email, password }) {
  const normalizedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

  if (existingUser.rowCount > 0) {
    throw createError('Email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at, updated_at`,
      [normalizedName, normalizedEmail, passwordHash, PUBLIC_REGISTRATION_ROLE]
    );

    const user = result.rows[0];

    return {
      user,
      ...generateTokens(user),
    };
  } catch (error) {
    if (error.code === '23505') {
      throw createError('Email already exists', 409);
    }

    throw error;
  }
}

export async function loginUser({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await query(
    `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at
     FROM users
     WHERE email = $1`,
    [normalizedEmail]
  );

  const user = result.rows[0];

  if (!user || !user.is_active) {
    throw createError('Invalid email or password', 401);
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw createError('Invalid email or password', 401);
  }

  const safeUser = sanitizeUser(user);

  return {
    user: safeUser,
    ...generateTokens(safeUser),
  };
}
