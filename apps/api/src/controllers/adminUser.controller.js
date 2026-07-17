import { listAdminUsers, updateAdminUserRole } from '../services/adminUser.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_ROLES = new Set(['viewer', 'manager', 'admin']);

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parsePositiveInteger(value, fieldName, defaultValue, maximum) {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw createError(`${fieldName} must be an integer between 1 and ${maximum}`, 400);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw createError(`${fieldName} must be an integer between 1 and ${maximum}`, 400);
  }
  return parsed;
}

export function parseAdminUserListQuery(query = {}) {
  const invalidField = Object.keys(query).find((field) => !['page', 'limit', 'role'].includes(field));
  if (invalidField) throw createError(`Invalid query field: ${invalidField}`, 400);

  if (query.role !== undefined && (typeof query.role !== 'string' || !USER_ROLES.has(query.role))) {
    throw createError('role must be viewer, manager, or admin', 400);
  }

  return {
    page: parsePositiveInteger(query.page, 'page', 1, Number.MAX_SAFE_INTEGER),
    limit: parsePositiveInteger(query.limit, 'limit', 20, 100),
    role: query.role,
  };
}

export function parseRoleUpdateBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw createError('Request body must be a JSON object', 400);
  }
  const fields = Object.keys(body);
  if (fields.length !== 1 || fields[0] !== 'role') {
    throw createError('Request body must contain only role', 400);
  }
  if (typeof body.role !== 'string' || !USER_ROLES.has(body.role)) {
    throw createError('role must be viewer, manager, or admin', 400);
  }
  return body.role;
}

export function createListAdminUsersHandler({ listFn = listAdminUsers } = {}) {
  return asyncHandler(async (req, res) => {
    const result = await listFn(parseAdminUserListQuery(req.query));
    res.status(200).json(result);
  });
}

export function createUpdateAdminUserRoleHandler({ updateFn = updateAdminUserRole } = {}) {
  return asyncHandler(async (req, res) => {
    const userId = req.params.id;
    if (typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
      throw createError('Invalid user id', 400);
    }
    const role = parseRoleUpdateBody(req.body);
    if (userId === req.user.id) {
      throw createError('Administrators cannot change their own role', 409);
    }
    const user = await updateFn(userId, role);
    res.status(200).json({ user });
  });
}

export const getAdminUsers = createListAdminUsersHandler();
export const patchAdminUserRole = createUpdateAdminUserRoleHandler();
