import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  bulkUpsertDailySales,
  fetchProductSalesHistory,
  verifyProductExists,
} = await import('../src/services/sales.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function createMockPool(queryHandler) {
  let released = false;
  const client = {
    query: queryHandler,
    release() {
      released = true;
    },
  };

  return {
    pool: {
      async connect() {
        return client;
      },
    },
    wasReleased: () => released,
  };
}

test('product existence verification uses a parameterized query', async () => {
  const calls = [];
  const exists = await verifyProductExists(PRODUCT_ID, {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: PRODUCT_ID }] };
    },
  });

  assert.equal(exists, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.doesNotMatch(calls[0].sql, new RegExp(PRODUCT_ID));
  assert.deepEqual(calls[0].params, [PRODUCT_ID]);
});

test('bulk sales are upserted in one transaction with all values parameterized', async () => {
  const calls = [];
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });

    if (sql.includes('SELECT id FROM products')) {
      return { rows: [{ id: PRODUCT_ID }] };
    }

    if (sql.includes('INSERT INTO sales_history')) {
      return { rowCount: 2 };
    }

    return { rows: [] };
  });
  const records = [
    { saleDate: '2026-07-13', unitsSold: 0, sellingPrice: 1200 },
    { saleDate: '2026-07-14', unitsSold: 5, sellingPrice: 1250.5 },
  ];

  const result = await bulkUpsertDailySales(PRODUCT_ID, records, { poolInstance: pool });

  assert.deepEqual(result, { upsertedCount: 2 });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'COMMIT');
  assert.equal(calls.filter(({ sql }) => sql === 'BEGIN').length, 1);
  assert.equal(calls.filter(({ sql }) => sql === 'COMMIT').length, 1);
  assert.equal(wasReleased(), true);

  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO sales_history'));
  assert.ok(insert);
  assert.match(insert.sql, /ON CONFLICT \(product_id, sale_date\)/);
  assert.match(insert.sql, /units_sold = EXCLUDED\.units_sold/);
  assert.match(insert.sql, /updated_at = NOW\(\)/);
  assert.match(insert.sql, /\$1/);
  assert.match(insert.sql, /\$10/);
  assert.doesNotMatch(insert.sql, /2026-07-13|2026-07-14|1250\.5|manual_api/);
  assert.deepEqual(insert.params, [
    PRODUCT_ID,
    '2026-07-13',
    0,
    1200,
    'manual_api',
    PRODUCT_ID,
    '2026-07-14',
    5,
    1250.5,
    'manual_api',
  ]);

  const mutatingSql = calls
    .map(({ sql }) => sql)
    .filter((sql) => /INSERT|UPDATE|DELETE/i.test(sql));
  assert.equal(mutatingSql.length, 1);
  assert.match(mutatingSql[0], /INSERT INTO sales_history/);
  assert.doesNotMatch(mutatingSql[0], /price_suggestions|price_history|products\s+SET/i);
});

test('duplicate request dates are rejected before opening a transaction', async () => {
  let connected = false;
  const poolInstance = {
    async connect() {
      connected = true;
    },
  };

  await assert.rejects(
    bulkUpsertDailySales(PRODUCT_ID, [
      { saleDate: '2026-07-14', unitsSold: 1, sellingPrice: 100 },
      { saleDate: '2026-07-14', unitsSold: 2, sellingPrice: 110 },
    ], { poolInstance }),
    (error) => error.statusCode === 400 && /Duplicate saleDate/.test(error.message)
  );
  assert.equal(connected, false);
});

test('missing products return 404 and roll back without inserting sales', async () => {
  const calls = [];
  const { pool, wasReleased } = createMockPool(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  });

  await assert.rejects(
    bulkUpsertDailySales(PRODUCT_ID, [
      { saleDate: '2026-07-14', unitsSold: 1, sellingPrice: 100 },
    ], { poolInstance: pool }),
    (error) => error.statusCode === 404 && error.message === 'Product not found'
  );

  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(calls.some(({ sql }) => sql.includes('INSERT INTO sales_history')), false);
  assert.equal(wasReleased(), true);
});

test('history applies date filters and limit, calculates revenue, and returns decimals unchanged', async () => {
  const calls = [];
  const rows = [{
    sale_date: '2026-07-14',
    units_sold: 5,
    selling_price: '1200.00',
    revenue: '6000.00',
    source: 'manual_api',
    created_at: '2026-07-14T10:00:00.000Z',
    updated_at: '2026-07-14T10:00:00.000Z',
  }, {
    sale_date: '2026-07-13',
    units_sold: 0,
    selling_price: '1100.00',
    revenue: '0.00',
    source: 'manual_api',
    created_at: '2026-07-13T10:00:00.000Z',
    updated_at: '2026-07-13T10:00:00.000Z',
  }];
  const queryFn = async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1 ? { rows: [{ id: PRODUCT_ID }] } : { rows };
  };

  const result = await fetchProductSalesHistory(
    PRODUCT_ID,
    { from: '2026-07-01', to: '2026-07-14', limit: 30 },
    { queryFn }
  );

  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /sale_date::text AS sale_date/);
  assert.match(calls[1].sql, /sale_date >= \$2::date/);
  assert.match(calls[1].sql, /sale_date <= \$3::date/);
  assert.match(calls[1].sql, /selling_price \* units_sold/);
  assert.match(calls[1].sql, /ORDER BY sale_date DESC/);
  assert.match(calls[1].sql, /LIMIT \$4/);
  assert.deepEqual(calls[1].params, [PRODUCT_ID, '2026-07-01', '2026-07-14', 30]);
  assert.deepEqual(result, {
    productId: PRODUCT_ID,
    items: [{
      saleDate: '2026-07-14',
      unitsSold: 5,
      sellingPrice: '1200.00',
      revenue: '6000.00',
      source: 'manual_api',
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedAt: '2026-07-14T10:00:00.000Z',
    }, {
      saleDate: '2026-07-13',
      unitsSold: 0,
      sellingPrice: '1100.00',
      revenue: '0.00',
      source: 'manual_api',
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
    }],
  });
});
