import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  IndianRupee,
  Loader2,
  RefreshCw,
  ShoppingBasket,
} from 'lucide-react';
import { FormEvent, lazy, Suspense, useEffect, useState } from 'react';

import {
  AnalyticsOverviewResponse,
  ApiError,
  GlobalPriceHistoryResponse,
  getAnalyticsOverview,
  getGlobalPriceHistory,
} from '../api/client';
import { formatInr, formatSaleDate } from '../utils/sales';

type Props = {
  accessToken: string;
  onUnauthorized: () => void;
};

const HISTORY_LIMIT = 20;
const AnalyticsRecordedChart = lazy(() => import('../components/AnalyticsRecordedChart'));

function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Boxes;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
        </div>
        <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-700"><Icon className="h-5 w-5" /></div>
      </div>
    </div>
  );
}

function messageFor(error: unknown, fallback: string, onUnauthorized: () => void) {
  if (error instanceof ApiError && error.statusCode === 401) {
    onUnauthorized();
    return 'Session expired. Please sign in again.';
  }
  return error instanceof Error ? error.message : fallback;
}

export default function AnalyticsPage({ accessToken, onUnauthorized }: Props) {
  const [fromInput, setFromInput] = useState(() => dateOffset(-29));
  const [toInput, setToInput] = useState(() => dateOffset(0));
  const [range, setRange] = useState(() => ({ from: dateOffset(-29), to: dateOffset(0) }));
  const [refreshKey, setRefreshKey] = useState(0);
  const [overview, setOverview] = useState<AnalyticsOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [history, setHistory] = useState<GlobalPriceHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    setIsOverviewLoading(true);
    setOverviewError('');
    getAnalyticsOverview(accessToken, range, controller.signal)
      .then(setOverview)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setOverviewError(messageFor(error, 'Unable to load recorded analytics.', onUnauthorized));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsOverviewLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, onUnauthorized, range, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setIsHistoryLoading(true);
    setHistoryError('');
    getGlobalPriceHistory(accessToken, {
      from: range.from,
      to: range.to,
      page: historyPage,
      limit: HISTORY_LIMIT,
    }, controller.signal)
      .then(setHistory)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setHistoryError(messageFor(error, 'Unable to load global price history.', onUnauthorized));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsHistoryLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, historyPage, onUnauthorized, range, refreshKey]);

  function applyRange(event: FormEvent) {
    event.preventDefault();
    setHistoryPage(1);
    setRange({ from: fromInput, to: toInput });
  }

  const chartData = overview?.dailySeries ?? [];
  const pagination = history?.pagination;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">Stored operational facts</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Analytics</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Figures cover manually/API-recorded sales only. They are not projected uplift and do not represent complete company revenue.
          </p>
        </div>
        <form className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-end" onSubmit={applyRange}>
          <label className="text-xs font-semibold text-slate-600">From
            <input className="mt-1 block h-10 rounded-lg border border-slate-200 px-3 text-sm" type="date" required value={fromInput} max={toInput} onChange={(event) => setFromInput(event.target.value)} />
          </label>
          <label className="text-xs font-semibold text-slate-600">To
            <input className="mt-1 block h-10 rounded-lg border border-slate-200 px-3 text-sm" type="date" required value={toInput} min={fromInput} onChange={(event) => setToInput(event.target.value)} />
          </label>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white" type="submit">Apply</button>
          <button className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw className="h-4 w-4" /> Refresh</button>
        </form>
      </section>

      {overviewError ? (
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{overviewError}</span>
          <button className="font-semibold underline" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button>
        </div>
      ) : null}

      <section aria-labelledby="recorded-kpis-title">
        <div className="mb-3">
          <h3 id="recorded-kpis-title" className="font-bold text-slate-950">Recorded data</h3>
          <p className="mt-1 text-xs text-slate-500">Selected range: {formatSaleDate(range.from)} to {formatSaleDate(range.to)}</p>
        </div>
        {isOverviewLoading && !overview ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading recorded metrics</div>
        ) : overview ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="Active products" value={overview.metrics.activeProductCount} detail="Current active product rows" icon={Boxes} />
            <KpiCard label="Recorded units sold" value={overview.metrics.recordedUnitsSold.toLocaleString('en-IN')} detail="Sum of stored units in range" icon={ShoppingBasket} />
            <KpiCard label="Realized recorded revenue" value={formatInr(overview.metrics.recordedRevenue)} detail="Stored units × selling price" icon={IndianRupee} />
            <KpiCard label="Recorded sales days" value={overview.metrics.recordedSalesDays} detail="Distinct stored sale dates" icon={CalendarDays} />
            <KpiCard label="Approved price changes" value={overview.metrics.approvedPriceChangeCount} detail="Stored approved history rows" icon={CheckCircle2} />
          </div>
        ) : null}
      </section>

      {overview ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="recorded-chart-title">
            <h3 id="recorded-chart-title" className="font-bold text-slate-950">Daily recorded units and revenue</h3>
            <p className="mt-1 text-xs text-slate-500">Only dates with stored sales rows are plotted.</p>
            {chartData.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-center text-sm text-slate-500">No recorded sales exist in this date range.</div>
            ) : (
              <Suspense fallback={<div className="flex h-80 items-center justify-center text-sm text-slate-500">Loading chart</div>}>
                <AnalyticsRecordedChart series={chartData} />
              </Suspense>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="suggestion-summary-title">
            <h3 id="suggestion-summary-title" className="font-bold text-slate-950">Suggestion status</h3>
            <p className="mt-1 text-xs text-slate-500">Current status of suggestions created in the selected range.</p>
            <div className="mt-5 space-y-3">
              {Object.entries(overview.suggestionCounts).map(([status, count]) => (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-3" key={status}>
                  <span className="text-sm font-semibold capitalize text-slate-700">{status}</span>
                  <span className="text-lg font-bold text-slate-950">{count}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="global-history-title">
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <h3 id="global-history-title" className="font-bold text-slate-950">Global price history</h3>
          <p className="mt-1 text-xs text-slate-500">Recorded price changes in the selected range, newest first.</p>
        </div>
        {historyError ? (
          <div className="m-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{historyError}</span><button className="font-semibold underline" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div>
        ) : null}
        {isHistoryLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading price history</div>
        ) : !history || history.items.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">No recorded price changes exist in this date range.</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Product</th><th className="px-5 py-3">Price change</th><th className="px-5 py-3">Change</th><th className="px-5 py-3">Source / reason</th><th className="px-5 py-3">Changed at</th></tr></thead>
                <tbody className="divide-y divide-slate-200">{history.items.map((item) => <tr key={item.id}><td className="px-5 py-4"><p className="font-semibold text-slate-950">{item.productName}</p><p className="text-xs text-slate-500">{item.productSku}</p></td><td className="whitespace-nowrap px-5 py-4 text-slate-700">{formatInr(item.oldPrice)} → {formatInr(item.newPrice)}</td><td className="px-5 py-4 font-semibold text-slate-700">{item.percentageChange === null ? 'N/A' : `${Number(item.percentageChange) > 0 ? '+' : ''}${item.percentageChange}%`}</td><td className="px-5 py-4 text-slate-600"><p className="capitalize">{item.source.replaceAll('_', ' ')}</p><p className="text-xs capitalize text-slate-500">{item.changeReason.replaceAll('_', ' ')}</p></td><td className="whitespace-nowrap px-5 py-4 text-slate-500">{new Date(item.changedAt).toLocaleString()}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-200 md:hidden">{history.items.map((item) => <article className="space-y-3 p-4" key={item.id}><div><p className="font-semibold text-slate-950">{item.productName}</p><p className="text-xs text-slate-500">SKU {item.productSku}</p></div><p className="text-sm text-slate-700">{formatInr(item.oldPrice)} → {formatInr(item.newPrice)} <span className="ml-1 font-semibold">{item.percentageChange === null ? 'N/A' : `${item.percentageChange}%`}</span></p><div className="flex items-center justify-between gap-3 text-xs text-slate-500"><span className="capitalize">{item.source.replaceAll('_', ' ')} · {item.changeReason.replaceAll('_', ' ')}</span><span>{new Date(item.changedAt).toLocaleString()}</span></div></article>)}</div>
          </>
        )}
        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm sm:px-5"><span className="text-slate-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} changes</span><div className="flex gap-2"><button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50" type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((value) => value - 1)}>Previous</button><button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50" type="button" disabled={historyPage >= pagination.totalPages} onClick={() => setHistoryPage((value) => value + 1)}>Next</button></div></div>
        ) : null}
      </section>
    </div>
  );
}
