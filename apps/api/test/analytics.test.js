import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

const {
  createGetAnalyticsOverviewHandler,
  parseAnalyticsOverviewQuery,
} = await import('../src/controllers/analytics.controller.js');
const { getAnalyticsOverview } = await import('../src/services/analytics.service.js');
const { errorMiddleware } = await import('../src/middleware/error.middleware.js');
const { default: analyticsRoutes } = await import('../src/routes/analytics.routes.js');

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

test('analytics range validation requires real dates, ordering, and at most 366 days', () => {
  assert.deepEqual(parseAnalyticsOverviewQuery({ from: '2026-01-01', to: '2026-12-31' }), {
    from: '2026-01-01',
    to: '2026-12-31',
  });
  assert.throws(() => parseAnalyticsOverviewQuery({ to: '2026-01-01' }), /from must use/);
  assert.throws(() => parseAnalyticsOverviewQuery({ from: '2026-02-30', to: '2026-03-01' }), /valid date/);
  assert.throws(() => parseAnalyticsOverviewQuery({ from: '2026-02-01', to: '2026-01-01' }), /on or before/);
  assert.throws(() => parseAnalyticsOverviewQuery({ from: '2025-01-01', to: '2026-01-02' }), /cannot exceed/);
  assert.throws(() => parseAnalyticsOverviewQuery({ from: '2026-01-01', to: '2026-01-02', fake: '1' }), /Invalid query field/);
});

test('analytics overview returns only stored recorded aggregates and chronological sales series', async () => {
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM products/.test(sql)) return { rows: [{ total: 7 }] };
    if (/COUNT\(DISTINCT sale_date\)/.test(sql)) {
      return { rows: [{ recordedUnitsSold: '12', recordedRevenue: '345.60', recordedSalesDays: 2 }] };
    }
    if (/FROM price_suggestions/.test(sql)) {
      return { rows: [{ status: 'pending', count: 3 }, { status: 'approved', count: 2 }] };
    }
    if (/FROM price_history/.test(sql)) return { rows: [{ total: 2 }] };
    return { rows: [
      { date: '2026-01-01', unitsSold: '5', revenue: '100.00' },
      { date: '2026-01-02', unitsSold: '7', revenue: '245.60' },
    ] };
  };

  const result = await getAnalyticsOverview(
    { from: '2026-01-01', to: '2026-01-31' },
    { queryFn }
  );

  assert.deepEqual(result, {
    range: { from: '2026-01-01', to: '2026-01-31' },
    metrics: {
      activeProductCount: 7,
      recordedUnitsSold: 12,
      recordedRevenue: '345.60',
      recordedSalesDays: 2,
      approvedPriceChangeCount: 2,
    },
    suggestionCounts: { pending: 3, approved: 2, rejected: 0, expired: 0 },
    dailySeries: [
      { date: '2026-01-01', unitsSold: 5, revenue: '100.00' },
      { date: '2026-01-02', unitsSold: 7, revenue: '245.60' },
    ],
  });
  assert.equal(calls.length, 5);
  assert.match(calls[1].sql, /units_sold \* selling_price/);
  assert.match(calls[3].sql, /change_reason = 'suggestion_approved'/);
  assert.match(calls[4].sql, /ORDER BY sale_date ASC/);
  for (const call of calls.slice(1)) assert.deepEqual(call.params, ['2026-01-01', '2026-01-31']);
  assert.doesNotMatch(JSON.stringify(result), /profit|margin|uplift|project/i);
});

test('analytics handler uses its validated contract and route requires authentication', async (t) => {
  const payload = { metrics: {}, suggestionCounts: {}, dailySeries: [] };
  const response = await invokeHandler(createGetAnalyticsOverviewHandler({
    getOverviewFn: async (range) => {
      assert.deepEqual(range, { from: '2026-01-01', to: '2026-01-02' });
      return payload;
    },
  }), { query: { from: '2026-01-01', to: '2026-01-02' } });
  assert.deepEqual(response, { statusCode: 200, body: payload });

  const app = express();
  app.use('/api/analytics', analyticsRoutes);
  app.use(errorMiddleware);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const unauthenticated = await fetch(`http://127.0.0.1:${server.address().port}/api/analytics/overview?from=2026-01-01&to=2026-01-02`);
  assert.equal(unauthenticated.status, 401);
});
