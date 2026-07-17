import { AlertTriangle, ExternalLink, Loader2, Search, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  GlobalCompetitorTargetsResponse,
  Product,
  getGlobalCompetitorTargets,
  getProduct,
} from '../api/client';
import { formatInr } from '../utils/sales';

type Props = {
  accessToken: string;
  canManage: boolean;
  onOpenProductTargets: (product: Product) => void;
  onUnauthorized: () => void;
};

const TARGETS_PER_PAGE = 20;

export default function CompetitorIntelligencePage({
  accessToken,
  canManage,
  onOpenProductTargets,
  onUnauthorized,
}: Props) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<GlobalCompetitorTargetsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [openingProductId, setOpeningProductId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError('');
      try {
        const next = await getGlobalCompetitorTargets(accessToken, {
          active: activeFilter === 'all' ? undefined : activeFilter === 'active',
          page,
          limit: TARGETS_PER_PAGE,
        }, controller.signal);
        if (!cancelled) setResult(next);
      } catch (loadError) {
        if (cancelled || controller.signal.aborted) return;
        if (loadError instanceof ApiError && loadError.statusCode === 401) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load configured targets.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessToken, activeFilter, onUnauthorized, page, refreshKey]);

  const targets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return result?.items ?? [];
    return (result?.items ?? []).filter((target) => [
      target.productName,
      target.productSku,
      target.competitorName,
      target.competitorUrl,
    ].some((value) => value.toLowerCase().includes(query)));
  }, [result, search]);

  async function openTargets(productId: string) {
    setOpeningProductId(productId);
    setError('');
    try {
      const response = await getProduct(accessToken, productId);
      onOpenProductTargets(response.product);
    } catch (openError) {
      if (openError instanceof ApiError && openError.statusCode === 401) {
        onUnauthorized();
      } else {
        setError(openError instanceof Error ? openError.message : 'Unable to open product targets.');
      }
    } finally {
      setOpeningProductId(null);
    }
  }

  const pagination = result?.pagination;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-indigo-700">Market monitoring</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Competitor Intelligence</h2>
        <p className="mt-2 text-sm text-slate-600">Review configured targets and their latest exact-match trusted scrape.</p>
      </section>

      {!canManage ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950" role="status">
          Viewer access is read-only. You can inspect targets and scrape results; target changes and scrapes require manager or admin access.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5">
          <label className="relative">
            <span className="sr-only">Search targets loaded on this page</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this loaded page"
            />
          </label>
          <select
            aria-label="Filter targets by active state"
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value as typeof activeFilter);
              setPage(1);
            }}
          >
            <option value="all">All targets</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh</button>
        </div>
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500 sm:px-5">Search filters only the targets loaded on the current server page.</p>

        {error ? (
          <div className="m-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button className="font-semibold underline" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading targets</div>
        ) : targets.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-500">
            {search ? 'No targets on this loaded page match the search.' : 'No configured targets match this filter.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {targets.map((target) => (
              <article className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_1.25fr_1fr_auto] lg:items-center" key={target.targetId}>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{target.productName}</p>
                  <p className="mt-1 truncate text-xs font-medium text-slate-500">SKU {target.productSku}</p>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-800">{target.competitorName}</p>
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${target.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>{target.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                  <a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-indigo-700 hover:underline" href={target.competitorUrl} target="_blank" rel="noreferrer">
                    <span className="truncate">{target.competitorUrl}</span><ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <div className="text-sm">
                  {target.latestScrape ? (
                    <>
                      <p className="font-bold text-slate-950">{formatInr(target.latestScrape.price)}</p>
                      <p className={`mt-1 text-xs font-semibold ${target.latestScrape.isAvailable ? 'text-emerald-700' : 'text-red-700'}`}>{target.latestScrape.isAvailable ? 'Available' : 'Unavailable'}</p>
                      <p className="mt-1 text-xs text-slate-500">{new Date(target.latestScrape.scrapedAt).toLocaleString()}</p>
                    </>
                  ) : (
                    <p className="text-sm font-medium text-slate-500">Never scraped</p>
                  )}
                </div>
                <button
                  className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  type="button"
                  disabled={openingProductId === target.productId}
                  onClick={() => void openTargets(target.productId)}
                >
                  {openingProductId === target.productId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                  {canManage ? 'Manage' : 'View'}
                </button>
              </article>
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm sm:px-5">
            <span className="text-slate-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} targets</span>
            <div className="flex gap-2">
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50" type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
