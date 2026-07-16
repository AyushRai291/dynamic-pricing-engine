import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Loader2,
  PackageSearch,
  ServerCog,
  TimerReset,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  Product,
  ProductsResponse,
  ScraperStatusResponse,
  getProducts,
  getScraperStatus,
} from '../api/client';
import CompetitorTargetsDialog from '../components/CompetitorTargetsDialog';
import Layout from '../components/Layout';
import ProductTable from '../components/ProductTable';
import QueueStatusPanel from '../components/QueueStatusPanel';
import SalesHistoryDialog from '../components/SalesHistoryDialog';

type DashboardPageProps = {
  accessToken: string;
  onLogout: () => void;
};

const PRODUCTS_PER_PAGE = 10;

function formatLastRefreshed(value: Date | null) {
  if (!value) {
    return 'not yet';
  }

  return value.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'slate',
  detail,
}: {
  label: string;
  value: number | string;
  icon: typeof PackageSearch;
  tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'indigo';
  detail?: string;
}) {
  const toneClass = {
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
          {detail ? <p className="mt-1 text-sm text-slate-500">{detail}</p> : null}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage({ accessToken, onLogout }: DashboardPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<ProductsResponse['pagination'] | null>(null);
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [queueStatus, setQueueStatus] = useState<ScraperStatusResponse | null>(null);
  const [queueError, setQueueError] = useState('');
  const [isQueueLoading, setIsQueueLoading] = useState(true);
  const [isQueueRefreshing, setIsQueueRefreshing] = useState(false);
  const [lastQueueRefresh, setLastQueueRefresh] = useState<Date | null>(null);

  const [selectedCompetitorProduct, setSelectedCompetitorProduct] = useState<Product | null>(null);
  const [selectedSalesProduct, setSelectedSalesProduct] = useState<Product | null>(null);

  const handleApiError = useCallback((error: unknown, fallbackMessage: string) => {
    if (error instanceof ApiError && error.statusCode === 401) {
      onLogout();
      return 'Session expired. Please sign in again.';
    }

    return error instanceof Error ? error.message : fallbackMessage;
  }, [onLogout]);

  const loadProducts = useCallback(async () => {
    setIsProductsLoading(true);
    setProductsError('');

    try {
      const result = await getProducts(accessToken, {
        page,
        limit: PRODUCTS_PER_PAGE,
        category: categoryFilter || undefined,
      });

      setProducts(result.items);
      setPagination(result.pagination);
      setKnownCategories((existingCategories) => {
        const next = new Set(existingCategories);

        for (const product of result.items) {
          if (product.category) {
            next.add(product.category);
          }
        }

        return Array.from(next).sort((a, b) => a.localeCompare(b));
      });
    } catch (error) {
      setProductsError(handleApiError(error, 'Unable to load products'));
    } finally {
      setIsProductsLoading(false);
    }
  }, [accessToken, categoryFilter, handleApiError, page]);

  const loadQueueStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsQueueRefreshing(true);
    }

    try {
      const result = await getScraperStatus(accessToken);
      setQueueStatus(result);
      setQueueError('');
      setLastQueueRefresh(new Date());
    } catch (error) {
      const message = handleApiError(error, 'Unable to load scraper queue status');
      setQueueStatus(null);
      setQueueError(message);
      setLastQueueRefresh(new Date());
    } finally {
      setIsQueueLoading(false);
      if (!silent) {
        setIsQueueRefreshing(false);
      }
    }
  }, [accessToken, handleApiError]);

  const refreshQueueSilently = useCallback(
    () => loadQueueStatus({ silent: true }),
    [loadQueueStatus]
  );

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    loadQueueStatus();
    const intervalId = window.setInterval(() => {
      loadQueueStatus({ silent: true });
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadQueueStatus]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return products;
    }

    return products.filter((product) => {
      const haystack = [
        product.name,
        product.sku,
        product.category || '',
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [products, searchQuery]);

  const queueAvailable = Boolean(queueStatus?.queue.available) && !queueError;
  const queueState = isQueueLoading
    ? 'checking'
    : queueAvailable
      ? 'connected'
      : 'disconnected';
  const lastRefreshedLabel = formatLastRefreshed(lastQueueRefresh);

  function handleCategoryChange(value: string) {
    setCategoryFilter(value);
    setPage(1);
  }

  const productTotal = pagination?.total ?? products.length;
  const queue = queueStatus?.queue;

  return (
    <Layout
      onLogout={onLogout}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      queueState={queueState}
      lastRefreshedLabel={lastRefreshedLabel}
      onRefreshQueue={() => loadQueueStatus()}
      isRefreshingQueue={isQueueRefreshing}
    >
      <div className="space-y-6">
        <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-semibold text-indigo-700">PricePilot AI</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
              Dynamic Pricing Engine
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Monitor product economics and manage competitor scraping through the Redis-backed queue.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            {isQueueLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : queueAvailable ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
            {isQueueLoading ? 'Checking queue status' : queueAvailable ? 'Queue operations available' : 'Scrape queue disconnected'}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Dashboard summary">
          <StatCard label="Products" value={productTotal} icon={PackageSearch} detail="From product API" tone="indigo" />
          <StatCard label="Waiting" value={queue?.waiting ?? '—'} icon={TimerReset} detail="Queue jobs" tone="slate" />
          <StatCard label="Active" value={queue?.active ?? '—'} icon={CircleDot} detail="Running now" tone="emerald" />
          <StatCard label="Completed" value={queue?.completed ?? '—'} icon={ClipboardList} detail="Retained jobs" tone="slate" />
          <StatCard label="Failed" value={queue?.failed ?? '—'} icon={queue?.failed ? XCircle : ServerCog} detail="Retained failures" tone={queue?.failed ? 'red' : 'slate'} />
        </section>

        <QueueStatusPanel
          status={queueStatus}
          error={queueError}
          isLoading={isQueueLoading}
          isRefreshing={isQueueRefreshing}
          lastRefreshedLabel={lastRefreshedLabel}
          onRefresh={() => loadQueueStatus()}
        />

        <ProductTable
          products={filteredProducts}
          allLoadedCount={products.length}
          pagination={pagination}
          isLoading={isProductsLoading}
          error={productsError}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          categoryFilter={categoryFilter}
          categories={knownCategories}
          onCategoryChange={handleCategoryChange}
          page={page}
          onPageChange={setPage}
          onManageCompetitors={setSelectedCompetitorProduct}
          onViewSales={setSelectedSalesProduct}
        />
      </div>

      <CompetitorTargetsDialog
        product={selectedCompetitorProduct}
        isOpen={Boolean(selectedCompetitorProduct)}
        accessToken={accessToken}
        queueAvailable={queueAvailable}
        isQueueLoading={isQueueLoading}
        onClose={() => setSelectedCompetitorProduct(null)}
        onUnauthorized={onLogout}
        onRefreshQueue={refreshQueueSilently}
      />

      <SalesHistoryDialog
        product={selectedSalesProduct}
        isOpen={Boolean(selectedSalesProduct)}
        accessToken={accessToken}
        onClose={() => setSelectedSalesProduct(null)}
        onUnauthorized={onLogout}
      />
    </Layout>
  );
}
