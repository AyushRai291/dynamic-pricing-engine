import { query } from '../config/db.js';

const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected', 'expired'];

export async function getAnalyticsOverview({ from, to }, { queryFn = query } = {}) {
  const [productsResult, salesResult, suggestionsResult, changesResult, seriesResult] =
    await Promise.all([
      queryFn('SELECT COUNT(*)::int AS total FROM products WHERE is_active = TRUE'),
      queryFn(
        `SELECT
           COALESCE(SUM(units_sold), 0)::text AS "recordedUnitsSold",
           COALESCE(SUM(units_sold * selling_price), 0)::numeric(30,2)::text AS "recordedRevenue",
           COUNT(DISTINCT sale_date)::int AS "recordedSalesDays"
         FROM sales_history
         WHERE sale_date >= $1::date
           AND sale_date <= $2::date`,
        [from, to]
      ),
      queryFn(
        `SELECT status, COUNT(*)::int AS count
         FROM price_suggestions
         WHERE created_at >= $1::date
           AND created_at < ($2::date + INTERVAL '1 day')
         GROUP BY status`,
        [from, to]
      ),
      queryFn(
        `SELECT COUNT(*)::int AS total
         FROM price_history
         WHERE change_reason = 'suggestion_approved'
           AND suggestion_id IS NOT NULL
           AND created_at >= $1::date
           AND created_at < ($2::date + INTERVAL '1 day')`,
        [from, to]
      ),
      queryFn(
        `SELECT
           sale_date::text AS date,
           SUM(units_sold)::text AS "unitsSold",
           SUM(units_sold * selling_price)::numeric(30,2)::text AS revenue
         FROM sales_history
         WHERE sale_date >= $1::date
           AND sale_date <= $2::date
         GROUP BY sale_date
         ORDER BY sale_date ASC`,
        [from, to]
      ),
    ]);

  const suggestionCounts = Object.fromEntries(
    SUGGESTION_STATUSES.map((status) => [status, 0])
  );

  for (const row of suggestionsResult.rows) {
    if (Object.hasOwn(suggestionCounts, row.status)) {
      suggestionCounts[row.status] = Number(row.count) || 0;
    }
  }

  const sales = salesResult.rows[0] || {};

  return {
    range: { from, to },
    metrics: {
      activeProductCount: Number(productsResult.rows[0]?.total) || 0,
      recordedUnitsSold: Number(sales.recordedUnitsSold) || 0,
      recordedRevenue: sales.recordedRevenue || '0.00',
      recordedSalesDays: Number(sales.recordedSalesDays) || 0,
      approvedPriceChangeCount: Number(changesResult.rows[0]?.total) || 0,
    },
    suggestionCounts,
    dailySeries: seriesResult.rows.map((row) => ({
      date: row.date,
      unitsSold: Number(row.unitsSold) || 0,
      revenue: row.revenue,
    })),
  };
}
