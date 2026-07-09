import { createUser, loginUser } from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { generateAccessToken, verifyRefreshToken } from '../utils/jwt.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRefreshTokenPayload(refreshToken) {
  try {
    return verifyRefreshToken(refreshToken);
  } catch {
    throw createError('Invalid refresh token', 401);
  }
}

export const register = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || !email || !password.trim()) {
    throw createError('Name, email, and password are required', 400);
  }

  const result = await createUser({ name, email, password });

  res.status(201).json(result);
});

export const login = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password.trim()) {
    throw createError('Email and password are required', 400);
  }

  const result = await loginUser({ email, password });

  res.status(200).json(result);
});

export const refresh = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';

  if (!refreshToken) {
    throw createError('Refresh token is required', 400);
  }

  const payload = getRefreshTokenPayload(refreshToken);
  const accessToken = generateAccessToken({
    id: payload.sub,
    email: payload.email,
    role: payload.role,
  });

  res.status(200).json({ accessToken });
});

export const me = asyncHandler(async (req, res) => {
  res.status(200).json({ user: req.user });
});
