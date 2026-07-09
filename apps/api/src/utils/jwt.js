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

export function generateAccessToken(user) {
  return jwt.sign(createPayload(user), JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN,
  });
}

export function generateTokens(user) {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: jwt.sign(createPayload(user), JWT_REFRESH_SECRET, {
      expiresIn: JWT_REFRESH_EXPIRES_IN,
    }),
  };
}

export function verifyAccessToken(token) {
  return jwt.verify(token, JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}
