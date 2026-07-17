import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createCompetitorTarget,
  getActiveCompetitorTarget,
  listGlobalCompetitorTargets,
  listCompetitorTargets,
  updateCompetitorTarget,
} = await import('../src/services/competitorTarget.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const targetRow = {
  id: TARGET_ID,
  productId: PRODUCT_ID,
  competitorName: 'Store',
  competitorUrl: 'https://shop.example/p',
  isActive: true,
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
  latestScrape: null,
};

test('target creation and listing use parameterized SQL and active products', async () => {
  const createCalls = [];
  const created = await createCompetitorTarget(PRODUCT_ID, {
    competitorName: 'Store',
    competitorUrl: 'https://shop.example/p',
  }, { queryFn: async (sql, params) => {
    createCalls.push({ sql, params });
    return createCalls.length === 1 ? { rows: [{ id: PRODUCT_ID }] } : { rows: [targetRow] };
  } });

  assert.deepEqual(created, targetRow);
  assert.match(createCalls[0].sql, /id = \$1[\s\S]*is_active = TRUE/);
  assert.deepEqual(createCalls[0].params, [PRODUCT_ID]);
  assert.match(createCalls[1].sql, /VALUES \(\$1, \$2, \$3\)/);
  assert.doesNotMatch(createCalls[1].sql, /shop\.example|Store/);
  assert.deepEqual(createCalls[1].params, [PRODUCT_ID, 'Store', 'https://shop.example/p']);
  assert.match(createCalls[1].sql, /AS "competitorName"/);

  const listCalls = [];
  const items = await listCompetitorTargets(PRODUCT_ID, {
    queryFn: async (sql, params) => {
      listCalls.push({ sql, params });
      return listCalls.length === 1 ? { rows: [{ id: PRODUCT_ID }] } : { rows: [targetRow] };
    },
  });
  assert.deepEqual(items, [targetRow]);
  assert.match(listCalls[1].sql, /FROM competitor_targets ct/);
  assert.match(listCalls[1].sql, /LEFT JOIN LATERAL/);
  assert.match(listCalls[1].sql, /cd\.product_id = ct\.product_id/);
  assert.match(listCalls[1].sql, /cd\.competitor_name = ct\.competitor_name/);
  assert.match(listCalls[1].sql, /cd\.competitor_url = ct\.competitor_url/);
  assert.match(listCalls[1].sql, /WHERE ct\.product_id = \$1/);
  assert.match(listCalls[1].sql, /ORDER BY cd\.scraped_at DESC, cd\.created_at DESC, cd\.id DESC/);
  assert.doesNotMatch(listCalls[1].sql, /WHERE ct\.is_active = TRUE/);
  assert.deepEqual(listCalls[1].params, [PRODUCT_ID]);
});

test('target list maps the latest exact configured scrape without changing decimals or timestamps', async () => {
  const scrapedTarget = {
    ...targetRow,
    latestScrape: {
      price: '12345.67',
      isAvailable: true,
      scrapedAt: '2026-07-18T09:10:11.123Z',
    },
  };
  let callCount = 0;
  const items = await listCompetitorTargets(PRODUCT_ID, {
    queryFn: async () => {
      callCount += 1;
      return callCount === 1 ? { rows: [{ id: PRODUCT_ID }] } : { rows: [scrapedTarget] };
    },
  });

  assert.deepEqual(items, [scrapedTarget]);
  assert.equal(items[0].latestScrape.price, '12345.67');
  assert.equal(items[0].latestScrape.scrapedAt, '2026-07-18T09:10:11.123Z');
});

test('global target listing is paginated, filterable, active-product scoped, and exact-match trusted', async () => {
  const calls = [];
  const row = {
    targetId: TARGET_ID,
    productId: PRODUCT_ID,
    productName: 'Product',
    productSku: 'SKU-1',
    competitorName: 'Store',
    competitorUrl: 'https://shop.example/p',
    isActive: true,
    latestScrape: { price: '123.45', isAvailable: true, scrapedAt: '2026-07-17T00:00:00Z' },
  };
  const result = await listGlobalCompetitorTargets(
    { page: 2, limit: 10, isActive: true },
    { queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return calls.length === 1 ? { rows: [{ total: 11 }] } : { rows: [row] };
    } }
  );

  assert.deepEqual(result, {
    items: [row],
    pagination: { page: 2, limit: 10, total: 11, totalPages: 2 },
  });
  assert.match(calls[0].sql, /p\.is_active = TRUE AND ct\.is_active = \$1/);
  assert.deepEqual(calls[0].params, [true]);
  assert.match(calls[1].sql, /cd\.product_id = ct\.product_id/);
  assert.match(calls[1].sql, /cd\.competitor_name = ct\.competitor_name/);
  assert.match(calls[1].sql, /cd\.competitor_url = ct\.competitor_url/);
  assert.match(calls[1].sql, /latest\.price::text/);
  assert.deepEqual(calls[1].params, [true, 10, 10]);
});

test('never-scraped and inactive targets remain listable with latestScrape null', async () => {
  const inactiveTarget = { ...targetRow, isActive: false };
  let callCount = 0;
  const items = await listCompetitorTargets(PRODUCT_ID, {
    queryFn: async () => {
      callCount += 1;
      return callCount === 1 ? { rows: [{ id: PRODUCT_ID }] } : { rows: [inactiveTarget] };
    },
  });

  assert.deepEqual(items, [inactiveTarget]);
  assert.equal(items[0].isActive, false);
  assert.equal(items[0].latestScrape, null);
});

test('target update/deactivation is parameterized and scoped to product and target', async () => {
  const calls = [];
  const updated = await updateCompetitorTarget(PRODUCT_ID, TARGET_ID, {
    competitorUrl: 'https://shop.example/new',
    isActive: false,
  }, { queryFn: async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1
      ? { rows: [{ id: PRODUCT_ID }] }
      : { rows: [{ ...targetRow, competitorUrl: params[0], isActive: params[1] }] };
  } });

  assert.equal(updated.isActive, false);
  assert.match(calls[1].sql, /competitor_url = \$1/);
  assert.match(calls[1].sql, /is_active = \$2/);
  assert.match(calls[1].sql, /product_id = \$3[\s\S]*id = \$4/);
  assert.deepEqual(calls[1].params, [
    'https://shop.example/new',
    false,
    PRODUCT_ID,
    TARGET_ID,
  ]);
});

test('duplicates return clear 409 responses', async () => {
  let callCount = 0;
  await assert.rejects(
    createCompetitorTarget(PRODUCT_ID, {
      competitorName: 'Store',
      competitorUrl: 'https://shop.example/p',
    }, { queryFn: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { rows: [{ id: PRODUCT_ID }] };
      }

      const error = new Error('duplicate');
      error.code = '23505';
      throw error;
    } }),
    (error) => error.statusCode === 409 && /already exists/.test(error.message)
  );
});

test('missing products and targets return 404', async () => {
  await assert.rejects(
    listCompetitorTargets(PRODUCT_ID, { queryFn: async () => ({ rows: [] }) }),
    (error) => error.statusCode === 404 && error.message === 'Active product not found'
  );

  let callCount = 0;
  await assert.rejects(
    updateCompetitorTarget(PRODUCT_ID, TARGET_ID, { isActive: false }, {
      queryFn: async () => {
        callCount += 1;
        return callCount === 1 ? { rows: [{ id: PRODUCT_ID }] } : { rows: [] };
      },
    }),
    (error) => error.statusCode === 404 && error.message === 'Competitor target not found'
  );
});

test('active target lookup joins active products and rejects inactive or missing targets', async () => {
  const calls = [];
  const active = await getActiveCompetitorTarget(TARGET_ID, {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [targetRow] };
    },
  });
  assert.deepEqual(active, targetRow);
  assert.match(calls[0].sql, /JOIN products p ON p\.id = ct\.product_id/);
  assert.match(calls[0].sql, /ct\.id = \$1/);
  assert.match(calls[0].sql, /ct\.is_active = TRUE/);
  assert.match(calls[0].sql, /p\.is_active = TRUE/);
  assert.deepEqual(calls[0].params, [TARGET_ID]);

  await assert.rejects(
    getActiveCompetitorTarget(TARGET_ID, { queryFn: async () => ({ rows: [] }) }),
    (error) => error.statusCode === 404 && error.message === 'Active competitor target not found'
  );
});
