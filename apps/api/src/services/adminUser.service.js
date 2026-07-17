import { query } from '../config/db.js';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function listAdminUsers(
  { page, limit, role },
  { queryFn = query } = {}
) {
  const params = [];
  let whereSql = '';

  if (role !== undefined) {
    params.push(role);
    whereSql = `WHERE role = $${params.length}`;
  }

  const countResult = await queryFn(
    `SELECT COUNT(*)::int AS total FROM users ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total) || 0;
  const offset = (page - 1) * limit;
  const itemParams = [...params, limit, offset];
  const result = await queryFn(
    `SELECT
       id,
       name,
       email,
       role,
       is_active AS "isActive",
       created_at AS "createdAt"
     FROM users
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${itemParams.length - 1}
     OFFSET $${itemParams.length}`,
    itemParams
  );

  return {
    items: result.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateAdminUserRole(userId, role, { queryFn = query } = {}) {
  const result = await queryFn(
    `UPDATE users
     SET role = $2,
         updated_at = NOW()
     WHERE id = $1
       AND is_active = TRUE
     RETURNING
       id,
       name,
       email,
       role,
       is_active AS "isActive",
       created_at AS "createdAt"`,
    [userId, role]
  );

  if (!result.rows[0]) {
    throw createError('Active user not found', 404);
  }

  return result.rows[0];
}
