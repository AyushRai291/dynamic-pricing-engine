export function errorMiddleware(err, req, res, next) {
  const rawStatusCode = err.statusCode || err.status || 500;
  const statusCode = rawStatusCode >= 400 && rawStatusCode < 600 ? rawStatusCode : 500;
  const isJsonParseError = err.type === 'entity.parse.failed';
  const message = statusCode === 500 ? 'Internal Server Error' : err.message;

  if (isJsonParseError) {
    return res.status(400).json({
      error: {
        message: 'Invalid JSON body',
        statusCode: 400,
        requestId: req.requestId,
      },
    });
  }

  res.status(statusCode).json({
    error: {
      message: message || 'Internal Server Error',
      statusCode,
      requestId: req.requestId,
    },
  });
}
