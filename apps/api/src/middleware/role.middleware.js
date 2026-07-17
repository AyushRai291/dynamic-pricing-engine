function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function requireRole(...allowedRoles) {
  const allowedRoleSet = new Set(allowedRoles);

  return function requireRoleMiddleware(req, res, next) {
    if (!allowedRoleSet.has(req.user?.role)) {
      return next(createError('Insufficient permissions', 403));
    }

    next();
  };
}

export const requireManagerOrAdmin = requireRole('manager', 'admin');
