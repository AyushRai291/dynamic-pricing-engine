import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Radar,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';

import {
  ApiError,
  Product,
  ProductsResponse,
  createPriceSuggestion,
} from '../api/client';

type ProductTableProps = {
  products: Product[];
  allLoadedCount: number;
  pagination: ProductsResponse['pagination'] | null;
  isLoading: boolean;
  error: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  categories: string[];
  onCategoryChange: (value: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  onManageCompetitors: (product: Product) => void;
  onViewSales: (product: Product) => void;
  accessToken: string;
  onUnauthorized: () => void;
  onSuggestionGenerated: () => void;
};

type GenerationNotice = {
  tone: 'success' | 'error';
  message: string;
};

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function formatMoney(value: string | number | undefined) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '—';
  }

  return currencyFormatter.format(numericValue);
}

function formatMargin(product: Product) {
  const currentPrice = Number(product.current_price);
  const costPrice = Number(product.cost_price);

  if (!Number.isFinite(currentPrice) || !Number.isFinite(costPrice) || currentPrice <= 0) {
    return '—';
  }

  return `${(((currentPrice - costPrice) / currentPrice) * 100).toFixed(1)}%`;
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="h-5 w-52 animate-pulse rounded bg-slate-200" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="grid grid-cols-5 gap-4 px-5 py-4" key={index}>
            {Array.from({ length: 5 }).map((__, columnIndex) => (
              <div className="h-4 animate-pulse rounded bg-slate-100" key={columnIndex} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
        active
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-100 text-slate-600'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function ProductTable({
  products,
  allLoadedCount,
  pagination,
  isLoading,
  error,
  searchValue,
  onSearchChange,
  categoryFilter,
  categories,
  onCategoryChange,
  page,
  onPageChange,
  onManageCompetitors,
  onViewSales,
  accessToken,
  onUnauthorized,
  onSuggestionGenerated,
}: ProductTableProps) {
  const [generatingProductId, setGeneratingProductId] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<GenerationNotice | null>(null);

  async function handleGenerateSuggestion(product: Product) {
    if (generatingProductId) {
      return;
    }

    setGeneratingProductId(product.id);
    setGenerationNotice(null);

    try {
      await createPriceSuggestion(accessToken, product.id);
      setGenerationNotice({
        tone: 'success',
        message: `A pending experimental suggestion was created for ${product.name}.`,
      });
      onSuggestionGenerated();
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }

      if (error instanceof ApiError && error.statusCode === 409) {
        setGenerationNotice({
          tone: 'error',
          message: `${product.name} already has a pending suggestion. Open Price Suggestions to review it.`,
        });
        return;
      }

      if (error instanceof ApiError && error.statusCode === 503) {
        setGenerationNotice({
          tone: 'error',
          message: 'The pricing model is currently unavailable. Try again after the ML service recovers.',
        });
        return;
      }

      setGenerationNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to generate a price suggestion.',
      });
    } finally {
      setGeneratingProductId(null);
    }
  }

  if (isLoading) {
    return <TableSkeleton />;
  }

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-sm">
        {error}
      </section>
    );
  }

  const hasProducts = products.length > 0;
  const hasAnyLoadedProducts = allLoadedCount > 0;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="products-title">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 id="products-title" className="text-base font-bold text-slate-950">
            Products
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {pagination ? `${pagination.total} total products` : `${allLoadedCount} products loaded`}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="table-product-search">
            Search products
          </label>
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              id="table-product-search"
              type="search"
              placeholder="Filter loaded products"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>

          <label className="sr-only" htmlFor="category-filter">
            Filter by category
          </label>
          <select
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            id="category-filter"
            value={categoryFilter}
            onChange={(event) => onCategoryChange(event.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option value={category} key={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </div>

      {generationNotice ? (
        <div
          className={`flex items-start justify-between gap-3 border-b px-5 py-3 text-sm ${
            generationNotice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
          role={generationNotice.tone === 'success' ? 'status' : 'alert'}
        >
          <div className="flex gap-2">
            {generationNotice.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{generationNotice.message}</span>
          </div>
          <button
            className="rounded-md p-1 transition hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-current"
            type="button"
            aria-label="Dismiss suggestion generation message"
            onClick={() => setGenerationNotice(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {!hasAnyLoadedProducts ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">No products available</p>
          <p className="mt-1 text-sm text-slate-500">Products will appear here after the API returns them.</p>
        </div>
      ) : null}

      {hasAnyLoadedProducts && !hasProducts ? (
        <div className="px-5 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">No search results</p>
          <p className="mt-1 text-sm text-slate-500">Try a different product name, SKU, or category.</p>
        </div>
      ) : null}

      {hasProducts ? (
        <div className="overflow-x-auto">
          <table className="min-w-[1480px] divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Product name</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">SKU</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Category</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Current price</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Cost price</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Gross margin</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Inventory</th>
                <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {products.map((product) => (
                <tr className="transition hover:bg-slate-50" key={product.id}>
                  <td className="whitespace-nowrap px-5 py-4">
                    <div className="font-semibold text-slate-950">{product.name}</div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600">{product.sku}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                    {product.category || 'Uncategorized'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-slate-800">
                    {formatMoney(product.current_price)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right text-slate-600">
                    {formatMoney(product.cost_price)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right text-slate-700">
                    {formatMargin(product)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right text-slate-700">
                    {product.inventory_count}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <StatusBadge active={product.is_active} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                        type="button"
                        onClick={() => void handleGenerateSuggestion(product)}
                        disabled={Boolean(generatingProductId) || !product.is_active}
                        aria-label={`Generate price suggestion for ${product.name}`}
                        title={!product.is_active ? 'Only active products can receive suggestions.' : undefined}
                      >
                        {generatingProductId === product.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        {generatingProductId === product.id ? 'Generating' : 'Generate suggestion'}
                      </button>
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        type="button"
                        onClick={() => onViewSales(product)}
                        aria-label={`View sales history for ${product.name}`}
                      >
                        <History className="h-4 w-4" />
                        Sales history
                      </button>
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        type="button"
                        onClick={() => onManageCompetitors(product)}
                        aria-label={`Manage competitors for ${product.name}`}
                      >
                        <Radar className="h-4 w-4" />
                        Competitors
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pagination ? (
        <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Page {pagination.page} of {Math.max(totalPages, 1)}
          </p>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
