import { lazy, Suspense, useMemo } from 'react';
import { CalendarDays, IndianRupee, ShoppingBasket } from 'lucide-react';

import { ProductSalesHistoryRecord } from '../api/client';
import { formatInr, formatSaleDate, parseSalesDecimal } from '../utils/sales';

const SalesHistoryChart = lazy(() => import('./SalesHistoryChart'));

type SalesHistoryOverviewProps = {
  records: ProductSalesHistoryRecord[];
};

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof ShoppingBasket;
  tone: 'indigo' | 'emerald' | 'slate' | 'amber';
}) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-100 text-slate-700',
    amber: 'bg-amber-50 text-amber-700',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-2 truncate text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{detail}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function HistoryTable({ records }: SalesHistoryOverviewProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="sales-table-title">
      <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Loaded period</p>
        <h3 id="sales-table-title" className="mt-1 text-base font-bold text-slate-950">Daily history</h3>
        <p className="mt-1 text-sm text-slate-500">Newest records first, matching the API response.</p>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="min-w-[680px] divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500 sm:px-5">Date</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500 sm:px-5">Units sold</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500 sm:px-5">Selling price</th>
              <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500 sm:px-5">Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {records.map((record) => (
              <tr className={record.unitsSold === 0 ? 'bg-slate-50/80' : 'hover:bg-slate-50'} key={record.saleDate}>
                <td className="whitespace-nowrap px-4 py-3.5 font-semibold text-slate-800 sm:px-5">
                  {formatSaleDate(record.saleDate)}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right sm:px-5">
                  {record.unitsSold === 0 ? (
                    <span className="inline-flex rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                      0 · no sales
                    </span>
                  ) : (
                    <span className="font-semibold text-slate-800">{record.unitsSold}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right text-slate-700 sm:px-5">
                  {formatInr(record.sellingPrice)}
                </td>
                <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold text-emerald-700 sm:px-5">
                  {formatInr(record.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function SalesHistoryOverview({ records }: SalesHistoryOverviewProps) {
  const summary = useMemo(() => {
    let totalRevenue = 0;
    let sellingPriceTotal = 0;
    let validSellingPriceCount = 0;

    for (const record of records) {
      const revenue = parseSalesDecimal(record.revenue);
      const sellingPrice = parseSalesDecimal(record.sellingPrice);

      if (revenue !== null) totalRevenue += revenue;
      if (sellingPrice !== null) {
        sellingPriceTotal += sellingPrice;
        validSellingPriceCount += 1;
      }
    }

    return {
      totalUnits: records.reduce((total, record) => total + record.unitsSold, 0),
      totalRevenue,
      averageSellingPrice: validSellingPriceCount > 0 ? sellingPriceTotal / validSellingPriceCount : null,
      recordedDays: records.length,
    };
  }, [records]);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loaded sales period summary">
        <SummaryCard label="Total units" value={summary.totalUnits} detail="Across loaded records" icon={ShoppingBasket} tone="indigo" />
        <SummaryCard label="Total revenue" value={formatInr(summary.totalRevenue)} detail="Across loaded records" icon={IndianRupee} tone="emerald" />
        <SummaryCard label="Average selling price" value={formatInr(summary.averageSellingPrice)} detail="Simple average, loaded records" icon={IndianRupee} tone="amber" />
        <SummaryCard label="Recorded days" value={summary.recordedDays} detail="Loaded period only" icon={CalendarDays} tone="slate" />
      </section>
      <Suspense
        fallback={(
          <div
            className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-100"
            role="status"
            aria-label="Loading sales chart"
          />
        )}
      >
        <SalesHistoryChart records={records} />
      </Suspense>
      <HistoryTable records={records} />
    </>
  );
}
