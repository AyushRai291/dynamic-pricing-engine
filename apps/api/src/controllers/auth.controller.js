import { createUser, loginUser } from '../services/auth.service.js';
import { generateAccessToken, verifyRefreshToken } from '../utils/jwt.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function register(req, res, next) {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || !email || !password.trim()) {
      throw createError('Name, email, and password are required', 400);
    }

    const result = await createUser({ name, email, password });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password.trim()) {
      throw createError('Email and password are required', 400);
    }

    const result = await loginUser({ email, password });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function refresh(req, res, next) {
  try {
    const body = req.body || {};
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';

    if (!refreshToken) {
      throw createError('Refresh token is required', 400);
    }

    let payload;

    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw createError('Invalid refresh token', 401);
    }

    const accessToken = generateAccessToken({
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    });

    res.status(200).json({ accessToken });
  } catch (error) {
    next(error);
  }
}

export async function me(req, res, next) {
  try {
    res.status(200).json({ user: req.user });
  } catch (error) {
    next(error);
  }
}
