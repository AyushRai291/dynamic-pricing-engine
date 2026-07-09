import { query } from '../config/db.js';

const PRODUCT_COLUMNS = `
  id,
  name,
  sku,
  category,
  current_price,
  cost_price,
  min_price,
  max_price,
  inventory_count,
  is_active,
  metadata,
  created_at,
  updated_at
`;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getPagination(total, page, limit) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function listProducts({ page, limit, category, isActive }) {
  const where = [];
  const params = [];

  if (category !== undefined) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }

  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`is_active = $${params.length}`);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await query(`SELECT COUNT(*)::int AS total FROM products ${whereSql}`, params);
  const total = countResult.rows[0].total;
  const offset = (page - 1) * limit;
  const itemParams = [...params, limit, offset];

  const itemResult = await query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${itemParams.length - 1}
     OFFSET $${itemParams.length}`,
    itemParams
  );

  return {
    items: itemResult.rows,
    pagination: getPagination(total, page, limit),
  };
}

export async function getProductById(id) {
  const result = await query(
    `SELECT ${PRODUCT_COLUMNS}
     FROM products
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

export async function createProduct(product) {
  try {
    const result = await query(
      `INSERT INTO products (
        name,
        sku,
        category,
        current_price,
        cost_price,
        min_price,
        max_price,
        inventory_count,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${PRODUCT_COLUMNS}`,
      [
        product.name,
        product.sku,
        product.category,
        product.current_price,
        product.cost_price,
        product.min_price,
        product.max_price,
        product.inventory_count,
        product.metadata,
      ]
    );

    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw createError('SKU already exists', 409);
    }

    throw error;
  }
}

export async function updateProduct(id, changes) {
  const fields = Object.keys(changes);
  const setClauses = fields.map((field, index) => `${field} = $${index + 1}`);
  const params = fields.map((field) => changes[field]);

  params.push(id);

  const result = await query(
    `UPDATE products
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}
     RETURNING ${PRODUCT_COLUMNS}`,
    params
  );

  return result.rows[0] || null;
}

export async function getProductHistory(productId, { page, limit }) {
  const countResult = await query(
    'SELECT COUNT(*)::int AS total FROM price_history WHERE product_id = $1',
    [productId]
  );
  const total = countResult.rows[0].total;
  const offset = (page - 1) * limit;
  const result = await query(
    `SELECT
       id,
       product_id,
       old_price,
       new_price,
       change_reason,
       suggestion_id,
       changed_by,
       revenue_delta_7d,
       created_at
     FROM price_history
     WHERE product_id = $1
     ORDER BY created_at DESC
     LIMIT $2
     OFFSET $3`,
    [productId, limit, offset]
  );

  return {
    items: result.rows,
    pagination: getPagination(total, page, limit),
  };
}

export async function getProductCompetitors(productId) {
  const result = await query(
    `SELECT
       id,
       product_id,
       competitor_name,
       competitor_url,
       price,
       scraped_at,
       is_available,
       raw_html_hash,
       created_at
     FROM competitor_data
     WHERE product_id = $1
     ORDER BY scraped_at DESC
     LIMIT 20`,
    [productId]
  );

  return result.rows;
}
