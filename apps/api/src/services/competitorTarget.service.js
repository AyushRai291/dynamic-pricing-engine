import { query } from '../config/db.js';

const TARGET_COLUMNS = `
  id,
  product_id AS "productId",
  competitor_name AS "competitorName",
  competitor_url AS "competitorUrl",
  is_active AS "isActive",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function mapDuplicateError(error) {
  if (error.code === '23505') {
    throw createError('A target for this product and competitor already exists', 409);
  }

  throw error;
}

export async function assertActiveProduct(productId, { queryFn = query } = {}) {
  const result = await queryFn(
    `SELECT id
     FROM products
     WHERE id = $1
       AND is_active = TRUE`,
    [productId]
  );

  if (!result.rows[0]) {
    throw createError('Active product not found', 404);
  }
}

export async function listCompetitorTargets(productId, { queryFn = query } = {}) {
  await assertActiveProduct(productId, { queryFn });
  const result = await queryFn(
    `SELECT ${TARGET_COLUMNS}
     FROM competitor_targets
     WHERE product_id = $1
     ORDER BY created_at ASC, id ASC`,
    [productId]
  );

  return result.rows;
}

export async function createCompetitorTarget(
  productId,
  { competitorName, competitorUrl },
  { queryFn = query } = {}
) {
  await assertActiveProduct(productId, { queryFn });

  try {
    const result = await queryFn(
      `INSERT INTO competitor_targets (
         product_id,
         competitor_name,
         competitor_url
       )
       VALUES ($1, $2, $3)
       RETURNING ${TARGET_COLUMNS}`,
      [productId, competitorName, competitorUrl]
    );

    return result.rows[0];
  } catch (error) {
    return mapDuplicateError(error);
  }
}

export async function updateCompetitorTarget(
  productId,
  targetId,
  changes,
  { queryFn = query } = {}
) {
  await assertActiveProduct(productId, { queryFn });
  const columnNames = {
    competitorName: 'competitor_name',
    competitorUrl: 'competitor_url',
    isActive: 'is_active',
  };
  const entries = Object.entries(changes);
  const setClauses = entries.map(
    ([field], index) => `${columnNames[field]} = $${index + 1}`
  );
  const params = entries.map(([, value]) => value);

  params.push(productId, targetId);

  try {
    const result = await queryFn(
      `UPDATE competitor_targets
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE product_id = $${params.length - 1}
         AND id = $${params.length}
       RETURNING ${TARGET_COLUMNS}`,
      params
    );

    if (!result.rows[0]) {
      throw createError('Competitor target not found', 404);
    }

    return result.rows[0];
  } catch (error) {
    return mapDuplicateError(error);
  }
}

export async function getActiveCompetitorTarget(targetId, { queryFn = query } = {}) {
  const result = await queryFn(
    `SELECT
       ct.id,
       ct.product_id AS "productId",
       ct.competitor_name AS "competitorName",
       ct.competitor_url AS "competitorUrl"
     FROM competitor_targets ct
     JOIN products p ON p.id = ct.product_id
     WHERE ct.id = $1
       AND ct.is_active = TRUE
       AND p.is_active = TRUE`,
    [targetId]
  );

  if (!result.rows[0]) {
    throw createError('Active competitor target not found', 404);
  }

  return result.rows[0];
}
