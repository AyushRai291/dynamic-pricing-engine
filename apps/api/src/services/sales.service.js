import { pool, query } from '../config/db.js';

const MAX_BULK_RECORDS = 366;
const MANUAL_SOURCE = 'manual_api';

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateBulkRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > MAX_BULK_RECORDS) {
    throw createError(`records must contain between 1 and ${MAX_BULK_RECORDS} items`, 400);
  }

  const dates = new Set();

  for (const record of records) {
    if (dates.has(record.saleDate)) {
      throw createError(`Duplicate saleDate: ${record.saleDate}`, 400);
    }

    dates.add(record.saleDate);
  }
}

function mapSalesRow(row) {
  return {
    saleDate: row.sale_date,
    unitsSold: row.units_sold,
    sellingPrice: row.selling_price,
    revenue: row.revenue,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function verifyProductExists(productId, { queryFn = query } = {}) {
  const result = await queryFn('SELECT id FROM products WHERE id = $1', [productId]);
  return result.rows.length > 0;
}

export async function bulkUpsertDailySales(
  productId,
  records,
  { poolInstance = pool } = {}
) {
  validateBulkRecords(records);

  const client = await poolInstance.connect();

  try {
    await client.query('BEGIN');

    const productExists = await verifyProductExists(productId, {
      queryFn: (text, params) => client.query(text, params),
    });

    if (!productExists) {
      throw createError('Product not found', 404);
    }

    const params = [];
    const valueClauses = records.map((record, index) => {
      const offset = index * 5;
      params.push(
        productId,
        record.saleDate,
        record.unitsSold,
        record.sellingPrice,
        MANUAL_SOURCE
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
    });

    const result = await client.query(
      `INSERT INTO sales_history (
         product_id,
         sale_date,
         units_sold,
         selling_price,
         source
       )
       VALUES ${valueClauses.join(', ')}
       ON CONFLICT (product_id, sale_date)
       DO UPDATE SET
         units_sold = EXCLUDED.units_sold,
         selling_price = EXCLUDED.selling_price,
         source = EXCLUDED.source,
         updated_at = NOW()`,
      params
    );

    await client.query('COMMIT');
    return { upsertedCount: result.rowCount };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original database or validation error.
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function fetchProductSalesHistory(
  productId,
  { from, to, limit = 90 } = {},
  { queryFn = query } = {}
) {
  const productExists = await verifyProductExists(productId, { queryFn });

  if (!productExists) {
    throw createError('Product not found', 404);
  }

  const where = ['product_id = $1'];
  const params = [productId];

  if (from !== undefined) {
    params.push(from);
    where.push(`sale_date >= $${params.length}::date`);
  }

  if (to !== undefined) {
    params.push(to);
    where.push(`sale_date <= $${params.length}::date`);
  }

  params.push(limit);
  const result = await queryFn(
    `SELECT
       sale_date::text AS sale_date,
       units_sold,
       selling_price,
       (selling_price * units_sold)::NUMERIC(30,2) AS revenue,
       source,
       created_at,
       updated_at
     FROM sales_history
     WHERE ${where.join(' AND ')}
     ORDER BY sale_date DESC
     LIMIT $${params.length}`,
    params
  );

  return {
    productId,
    items: result.rows.map(mapSalesRow),
  };
}
