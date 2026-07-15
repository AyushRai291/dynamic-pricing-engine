import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ProductSalesHistoryRecord } from '../api/client';
import { formatInr, formatSaleDate, parseSalesDecimal } from '../utils/sales';

type SalesHistoryChartProps = {
  records: ProductSalesHistoryRecord[];
};

type SalesChartPoint = {
  saleDate: string;
  unitsSold: number;
  sellingPrice: number | null;
  revenue: number | null;
};

const MAX_CHART_RECORDS = 30;

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export default function SalesHistoryChart({ records }: SalesHistoryChartProps) {
  const chartData: SalesChartPoint[] = records
    .slice(0, MAX_CHART_RECORDS)
    .map((record) => ({
      saleDate: record.saleDate,
      unitsSold: record.unitsSold,
      sellingPrice: parseSalesDecimal(record.sellingPrice),
      revenue: parseSalesDecimal(record.revenue),
    }))
    .reverse();

  if (chartData.length === 0) {
    return null;
  }

  const allUnitsZero = chartData.every((record) => record.unitsSold === 0);
  const totalUnits = chartData.reduce((total, record) => total + record.unitsSold, 0);
  const firstDate = chartData[0].saleDate;
  const lastDate = chartData.at(-1)?.saleDate ?? firstDate;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
      aria-labelledby="sales-chart-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">
            Loaded period
          </p>
          <h3 id="sales-chart-title" className="mt-1 text-base font-bold text-slate-950">
            Sales and revenue trend
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Up to the 30 most recent loaded records, displayed chronologically.
          </p>
        </div>
        {allUnitsZero ? (
          <span className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
            All loaded days have zero units
          </span>
        ) : null}
      </div>

      <p className="sr-only" id="sales-chart-summary">
        Sales chart from {formatSaleDate(firstDate)} to {formatSaleDate(lastDate)} covering{' '}
        {chartData.length} recorded days and {totalUnits} total units. Bars show units sold; lines show
        selling price and revenue.
      </p>

      <div
        className="mt-5 h-80 min-w-0"
        role="img"
        aria-labelledby="sales-chart-title"
        aria-describedby="sales-chart-summary"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="saleDate"
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tick={{ fill: '#64748b', fontSize: 12 }}
              tickFormatter={(value: string) => formatSaleDate(value, true)}
            />
            <YAxis
              yAxisId="units"
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              width={44}
              tick={{ fill: '#64748b', fontSize: 12 }}
            />
            <YAxis
              yAxisId="currency"
              orientation="right"
              axisLine={false}
              tickLine={false}
              width={64}
              tick={{ fill: '#64748b', fontSize: 12 }}
              tickFormatter={(value: number) => formatCompactCurrency(value)}
            />
            <Tooltip
              cursor={{ fill: '#eef2ff', opacity: 0.7 }}
              labelFormatter={(label) => `Date: ${formatSaleDate(String(label))}`}
              formatter={(value, name) => {
                const normalizedValue = Array.isArray(value) ? value[0] : value;

                if (name === 'Units sold') {
                  return [String(normalizedValue), name];
                }

                const numericValue = Number(normalizedValue);
                return [formatInr(Number.isFinite(numericValue) ? numericValue : null), name];
              }}
              contentStyle={{
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
              }}
            />
            <Legend wrapperStyle={{ color: '#475569', fontSize: 12, paddingTop: 12 }} />
            <Bar
              yAxisId="units"
              dataKey="unitsSold"
              name="Units sold"
              fill="#4f46e5"
              radius={[5, 5, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
            <Line
              yAxisId="currency"
              type="monotone"
              dataKey="sellingPrice"
              name="Selling price"
              stroke="#64748b"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2, fill: '#64748b' }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="currency"
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke="#059669"
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: '#059669' }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
