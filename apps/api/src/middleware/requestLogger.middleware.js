export function createRequestLogger({ log = console.log, now = Date.now } = {}) {
  return function requestLogger(req, res, next) {
    const startedAt = now();
    const requestPath = req.originalUrl.split('?')[0];

    res.on('finish', () => {
      const durationMs = now() - startedAt;
      log(
        `requestId=${req.requestId} method=${req.method} path=${requestPath} `
        + `status=${res.statusCode} durationMs=${durationMs}`
      );
    });

    next();
  };
}

export const requestLoggerMiddleware = createRequestLogger();
