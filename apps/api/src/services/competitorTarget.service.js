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
    `SELECT
       ct.id,
       ct.product_id AS "productId",
       ct.competitor_name AS "competitorName",
       ct.competitor_url AS "competitorUrl",
       ct.is_active AS "isActive",
       ct.created_at AS "createdAt",
       ct.updated_at AS "updatedAt",
       CASE
         WHEN latest.id IS NULL THEN NULL
         ELSE json_build_object(
           'price', latest.price::text,
           'isAvailable', latest.is_available,
           'scrapedAt', latest.scraped_at
         )
       END AS "latestScrape"
     FROM competitor_targets ct
     LEFT JOIN LATERAL (
       SELECT
         cd.id,
         cd.price,
         cd.is_available,
         cd.scraped_at
       FROM competitor_data cd
       WHERE cd.product_id = ct.product_id
         AND cd.competitor_name = ct.competitor_name
         AND cd.competitor_url = ct.competitor_url
       ORDER BY cd.scraped_at DESC, cd.created_at DESC, cd.id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE ct.product_id = $1
     ORDER BY ct.created_at ASC, ct.id ASC`,
    [productId]
  );

  return result.rows;
}

export async function listGlobalCompetitorTargets(
  { page, limit, isActive },
  { queryFn = query } = {}
) {
  const filterParams = [];
  let activeClause = '';

  if (isActive !== undefined) {
    filterParams.push(isActive);
    activeClause = ` AND ct.is_active = $${filterParams.length}`;
  }

  const countResult = await queryFn(
    `SELECT COUNT(*)::int AS total
     FROM competitor_targets ct
     JOIN products p ON p.id = ct.product_id
     WHERE p.is_active = TRUE${activeClause}`,
    filterParams
  );
  const offset = (page - 1) * limit;
  const dataParams = [...filterParams, limit, offset];
  const limitParam = dataParams.length - 1;
  const offsetParam = dataParams.length;
  const result = await queryFn(
    `SELECT
       ct.id AS "targetId",
       ct.competitor_name AS "competitorName",
       ct.competitor_url AS "competitorUrl",
       ct.is_active AS "isActive",
       p.id AS "productId",
       p.name AS "productName",
       p.sku AS "productSku",
       CASE
         WHEN latest.id IS NULL THEN NULL
         ELSE json_build_object(
           'price', latest.price::text,
           'isAvailable', latest.is_available,
           'scrapedAt', latest.scraped_at
         )
       END AS "latestScrape"
     FROM competitor_targets ct
     JOIN products p ON p.id = ct.product_id
     LEFT JOIN LATERAL (
       SELECT cd.id, cd.price, cd.is_available, cd.scraped_at
       FROM competitor_data cd
       WHERE cd.product_id = ct.product_id
         AND cd.competitor_name = ct.competitor_name
         AND cd.competitor_url = ct.competitor_url
       ORDER BY cd.scraped_at DESC, cd.created_at DESC, cd.id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE p.is_active = TRUE${activeClause}
     ORDER BY p.name ASC, p.id ASC, ct.created_at ASC, ct.id ASC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    dataParams
  );
  const total = Number(countResult.rows[0]?.total) || 0;

  return {
    items: result.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
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
