import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  getActiveConfiguredScrapeTargets,
  scrapeAndStoreCompetitorData,
} = await import('../src/services/scraper.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

test('scheduler source query reads only active configured targets and active products', async () => {
  const calls = [];
  const rows = [{
    targetId: '22222222-2222-4222-8222-222222222222',
    productId: PRODUCT_ID,
    competitorName: 'Store',
    competitorUrl: 'https://shop.example/p',
  }];
  const result = await getActiveConfiguredScrapeTargets({
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    },
  });

  assert.deepEqual(result, rows);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM competitor_targets ct/);
  assert.match(calls[0].sql, /JOIN products p ON p\.id = ct\.product_id/);
  assert.match(calls[0].sql, /ct\.is_active = TRUE/);
  assert.match(calls[0].sql, /p\.is_active = TRUE/);
  assert.doesNotMatch(calls[0].sql, /competitor_data/);
  assert.deepEqual(calls[0].params, undefined);
});

test('mockHtml scraping remains deterministic, parameterized, and stores a parsed row', async () => {
  const calls = [];
  let fetchCalled = false;
  const insertedRow = {
    id: '33333333-3333-4333-8333-333333333333',
    product_id: PRODUCT_ID,
    competitor_name: 'Local fixture',
    competitor_url: 'http://127.0.0.1:9999/product',
    price: '42.50',
    scraped_at: '2026-07-17T00:00:00.000Z',
    is_available: true,
  };
  const result = await scrapeAndStoreCompetitorData({
    productId: PRODUCT_ID,
    competitorName: 'Local fixture',
    competitorUrl: 'http://127.0.0.1:9999/product',
    mockHtml: '<div class="price">INR 42.50</div>',
  }, {
    queryFn: async (sql, params) => {
      calls.push({ sql, params });
      return calls.length === 1
        ? { rowCount: 1, rows: [{ id: PRODUCT_ID }] }
        : { rowCount: 1, rows: [insertedRow] };
    },
    fetchHtmlFn: async () => {
      fetchCalled = true;
    },
  });

  assert.deepEqual(result, insertedRow);
  assert.equal(fetchCalled, false);
  assert.match(calls[0].sql, /WHERE id = \$1/);
  assert.deepEqual(calls[0].params, [PRODUCT_ID]);
  assert.match(calls[1].sql, /INSERT INTO competitor_data/);
  assert.match(calls[1].sql, /VALUES \(\$1, \$2, \$3, \$4, NOW\(\), TRUE, \$5\)/);
  assert.doesNotMatch(calls[1].sql, /Local fixture|127\.0\.0\.1|42\.50/);
  assert.deepEqual(calls[1].params.slice(0, 4), [
    PRODUCT_ID,
    'Local fixture',
    'http://127.0.0.1:9999/product',
    42.5,
  ]);
  assert.match(calls[1].params[4], /^[0-9a-f]{32}$/);
});
