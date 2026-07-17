import { randomUUID } from 'node:crypto';

export function requestIdMiddleware(req, res, next) {
  const requestId = randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
