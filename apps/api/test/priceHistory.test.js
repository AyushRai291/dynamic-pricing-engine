import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createListPriceHistoryHandler,
  parsePriceHistoryQuery,
} = await import('../src/controllers/pricing.controller.js');
const { listGlobalPriceHistory } = await import('../src/services/pricing.service.js');

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

function invokeHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ statusCode: this.statusCode, body }); },
    };
    handler(req, res, (error) => (error ? reject(error) : resolve()));
  });
}

test('global price history query validates optional filters and pagination', () => {
  assert.deepEqual(parsePriceHistoryQuery({
    productId: PRODUCT_ID,
    from: '2026-01-01',
    to: '2026-01-31',
    page: '2',
    limit: '100',
  }), {
    productId: PRODUCT_ID,
    from: '2026-01-01',
    to: '2026-01-31',
    page: 2,
    limit: 100,
  });
  assert.throws(() => parsePriceHistoryQuery({ productId: ['bad'] }), /Invalid product id/);
  assert.throws(() => parsePriceHistoryQuery({ from: '2026-02-30' }), /valid date/);
  assert.throws(() => parsePriceHistoryQuery({ from: '2026-02-02', to: '2026-02-01' }), /on or before/);
  assert.throws(() => parsePriceHistoryQuery({ page: '0' }), /between/);
  assert.throws(() => parsePriceHistoryQuery({ limit: '101' }), /between/);
});

test('global history uses parameterized filters, decimal strings, and newest-first ordering', async () => {
  const calls = [];
  const item = {
    id: '22222222-2222-4222-8222-222222222222',
    productId: PRODUCT_ID,
    productName: 'Product',
    productSku: 'SKU-1',
    oldPrice: '100.00',
    newPrice: '110.00',
    percentageChange: '10.00',
    source: 'price_suggestion',
    changeReason: 'suggestion_approved',
    suggestionId: '33333333-3333-4333-8333-333333333333',
    changedAt: '2026-01-10T10:00:00.000Z',
  };
  const result = await listGlobalPriceHistory({
    productId: PRODUCT_ID,
    from: '2026-01-01',
    to: '2026-01-31',
    page: 2,
    limit: 10,
  }, { queryFn: async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1 ? { rows: [{ total: 11 }] } : { rows: [item] };
  } });

  assert.deepEqual(result, {
    items: [item],
    pagination: { page: 2, limit: 10, total: 11, totalPages: 2 },
  });
  assert.deepEqual(calls[0].params, [PRODUCT_ID, '2026-01-01', '2026-01-31']);
  assert.deepEqual(calls[1].params, [PRODUCT_ID, '2026-01-01', '2026-01-31', 10, 10]);
  assert.match(calls[1].sql, /old_price::text/);
  assert.match(calls[1].sql, /ROUND\(\(\(ph\.new_price - ph\.old_price\)/);
  assert.match(calls[1].sql, /WHEN ph\.suggestion_id IS NOT NULL THEN 'price_suggestion'/);
  assert.match(calls[1].sql, /ORDER BY ph\.created_at DESC, ph\.id DESC/);
});

test('price history handler returns the paginated service contract', async () => {
  const result = { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
  const response = await invokeHandler(createListPriceHistoryHandler({
    listFn: async (filters) => {
      assert.deepEqual(filters, { productId: undefined, from: undefined, to: undefined, page: 1, limit: 20 });
      return result;
    },
  }), { query: {} });
  assert.deepEqual(response, { statusCode: 200, body: result });
});
