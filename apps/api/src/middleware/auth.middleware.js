import { findUserById } from '../services/auth.service.js';
import { verifyAccessToken } from '../utils/jwt.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.get('authorization') || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw createError('Missing or invalid authorization token', 401);
    }

    let payload;

    try {
      payload = verifyAccessToken(token);
    } catch {
      throw createError('Missing or invalid authorization token', 401);
    }

    const user = await findUserById(payload.sub);

    if (!user || !user.is_active) {
      throw createError('Missing or invalid authorization token', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
