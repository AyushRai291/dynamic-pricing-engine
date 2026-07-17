import { NODE_ENV } from '../config/env.js';

export const REFRESH_COOKIE_NAME = 'dpe_refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';

export function getRefreshCookieOptions(
  expiresAt,
  { production = NODE_ENV === 'production', now = Date.now() } = {}
) {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const maxAge = expiry.getTime() - now;

  if (!Number.isFinite(expiry.getTime()) || maxAge <= 0) {
    throw new Error('Refresh cookie expiry must be in the future');
  }

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    path: REFRESH_COOKIE_PATH,
    expires: expiry,
    maxAge,
  };
}

export function getRefreshCookieClearOptions({ production = NODE_ENV === 'production' } = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    path: REFRESH_COOKIE_PATH,
  };
}

export function readRefreshCookie(req) {
  const cookieHeader = req.get('cookie');

  if (!cookieHeader) return null;

  for (const segment of cookieHeader.split(';')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex < 0) continue;

    const name = segment.slice(0, separatorIndex).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;

    try {
      return decodeURIComponent(segment.slice(separatorIndex + 1).trim()) || null;
    } catch {
      return null;
    }
  }

  return null;
}

export function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    getRefreshCookieOptions(expiresAt)
  );
}

export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, getRefreshCookieClearOptions());
}
