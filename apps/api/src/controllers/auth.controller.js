import {
  createUser,
  loginUser,
  revokeRefreshSession,
  rotateRefreshSession,
} from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from '../utils/authCookie.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendAuthResult(res, statusCode, result) {
  const {
    refreshToken,
    refreshExpiresAt,
    ...publicResult
  } = result;

  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.status(statusCode).json(publicResult);
}

export function createRegisterHandler({ createUserFn = createUser } = {}) {
  return asyncHandler(async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!name || !email || !password.trim()) {
      throw createError('Name, email, and password are required', 400);
    }

    sendAuthResult(res, 201, await createUserFn({ name, email, password }));
  });
}

export function createLoginHandler({ loginUserFn = loginUser } = {}) {
  return asyncHandler(async (req, res) => {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password.trim()) {
      throw createError('Email and password are required', 400);
    }

    sendAuthResult(res, 200, await loginUserFn({ email, password }));
  });
}

export function createRefreshHandler({ rotateFn = rotateRefreshSession } = {}) {
  return asyncHandler(async (req, res) => {
    try {
      const refreshToken = readRefreshCookie(req);
      if (!refreshToken) throw createError('Invalid refresh session', 401);

      const result = await rotateFn(refreshToken);
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
      res.status(200).json({ accessToken: result.accessToken });
    } catch (error) {
      if (error.statusCode === 401) {
        clearRefreshCookie(res);
      }
      throw error;
    }
  });
}

export function createLogoutHandler({ revokeFn = revokeRefreshSession } = {}) {
  return asyncHandler(async (req, res) => {
    const refreshToken = readRefreshCookie(req);

    try {
      if (refreshToken) await revokeFn(refreshToken);
    } finally {
      clearRefreshCookie(res);
    }

    res.status(204).end();
  });
}

export const register = createRegisterHandler();
export const login = createLoginHandler();
export const refresh = createRefreshHandler();
export const logout = createLogoutHandler();

export const me = asyncHandler(async (req, res) => {
  res.status(200).json({ user: req.user });
});
