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

import { AnalyticsOverviewResponse } from '../api/client';
import { formatInr, formatSaleDate, parseSalesDecimal } from '../utils/sales';

type Props = {
  series: AnalyticsOverviewResponse['dailySeries'];
};

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export default function AnalyticsRecordedChart({ series }: Props) {
  const chartData = series.map((point) => ({
    ...point,
    revenueValue: parseSalesDecimal(point.revenue) ?? 0,
  }));

  return (
    <div className="mt-5 h-80 min-w-0" role="img" aria-label="Daily recorded units sold and revenue chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={24} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(value: string) => formatSaleDate(value, true)} />
          <YAxis yAxisId="units" axisLine={false} tickLine={false} allowDecimals={false} width={44} tick={{ fill: '#64748b', fontSize: 12 }} />
          <YAxis yAxisId="revenue" orientation="right" axisLine={false} tickLine={false} width={64} tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={formatCompactCurrency} />
          <Tooltip labelFormatter={(label) => `Date: ${formatSaleDate(String(label))}`} formatter={(value, name) => name === 'Recorded units' ? [String(value), name] : [formatInr(Number(value)), name]} />
          <Legend />
          <Bar yAxisId="units" dataKey="unitsSold" name="Recorded units" fill="#4f46e5" radius={[5, 5, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Line yAxisId="revenue" type="monotone" dataKey="revenueValue" name="Recorded revenue" stroke="#059669" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
