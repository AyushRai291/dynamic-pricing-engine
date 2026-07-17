import jwt from 'jsonwebtoken';

import {
  JWT_ACCESS_EXPIRES_IN,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_EXPIRES_IN,
  JWT_REFRESH_SECRET,
} from '../config/env.js';

function createPayload(user) {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
}

function createRefreshPayload(user) {
  return {
    sub: user.id,
    type: 'refresh',
  };
}

export function generateAccessToken(user) {
  return jwt.sign(createPayload(user), JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN,
  });
}

export function generateRefreshToken(user, sessionId) {
  return jwt.sign(createRefreshPayload(user), JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    jwtid: sessionId,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, JWT_REFRESH_SECRET);

  if (payload.type !== 'refresh') {
    throw new Error('Invalid refresh token type');
  }

  return payload;
}
