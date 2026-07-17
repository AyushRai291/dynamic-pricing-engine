import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  PriceSuggestion,
  PriceSuggestionStatus,
  getPriceSuggestions,
} from '../api/client';
import PriceSuggestionDetail from '../components/PriceSuggestionDetail';
import { formatInr } from '../utils/sales';

type ReviewStatus = PriceSuggestionStatus;

type PriceSuggestionsPageProps = {
  accessToken: string;
  canManage: boolean;
  refreshKey: number;
  onUnauthorized: () => void;
  onProductsChanged: () => void | Promise<void>;
};

const STATUS_TABS: Array<{ value: ReviewStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not recorded';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatPercentage(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function humanize(value: string | null) {
  return value ? value.replaceAll('_', ' ') : 'Not available';
}

function getExpiresAt(suggestion: PriceSuggestion) {
  return suggestion.expiresAt ?? suggestion.expires_at;
}

function StatusBadge({ status }: { status: PriceSuggestion['status'] }) {
  const classes = {
    pending: 'border-amber-200 bg-amber-50 text-amber-800',
    approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    rejected: 'border-red-200 bg-red-50 text-red-800',
    expired: 'border-slate-200 bg-slate-100 text-slate-600',
  }[status];

  return (
    <span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold capitalize ${classes}`}>
      {status}
    </span>
  );
}

function ActionLabel({ suggestion }: { suggestion: PriceSuggestion }) {
  const Icon = suggestion.action === 'increase'
    ? ArrowUpRight
    : suggestion.action === 'decrease'
      ? ArrowDownRight
      : ArrowRight;
  const classes = suggestion.action === 'increase'
    ? 'text-emerald-700'
    : suggestion.action === 'decrease'
      ? 'text-red-700'
      : 'text-slate-700';

  return (
    <span className={`inline-flex items-center gap-1 font-semibold capitalize ${classes}`}>
      <Icon className="h-4 w-4" />
      {suggestion.action || 'Not available'}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" role="status" aria-label="Loading price suggestions">
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="grid gap-3 px-5 py-5 sm:grid-cols-4" key={index}>
            <div className="h-4 animate-pulse rounded bg-slate-200 sm:col-span-2" />
            <div className="h-4 animate-pulse rounded bg-slate-100" />
            <div className="h-4 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading real suggestion records.</span>
    </div>
  );
}

export default function PriceSuggestionsPage({
  accessToken,
  canManage,
  refreshKey,
  onUnauthorized,
  onProductsChanged,
}: PriceSuggestionsPageProps) {
  const [activeStatus, setActiveStatus] = useState<ReviewStatus>('pending');
  const [suggestions, setSuggestions] = useState<PriceSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const activeRequestRef = useRef<AbortController | null>(null);

  const loadSuggestions = useCallback(async () => {
    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsLoading(true);
    setLoadError('');

    try {
      const result = await getPriceSuggestions(accessToken, activeStatus, 20, controller.signal);

      if (!controller.signal.aborted) {
        setSuggestions(result.items);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }

      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }

      setLoadError(error instanceof Error ? error.message : 'Unable to load price suggestions.');
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [accessToken, activeStatus, onUnauthorized]);

  useEffect(() => {
    void loadSuggestions();

    return () => {
      activeRequestRef.current?.abort();
    };
  }, [loadSuggestions, refreshKey]);

  function handleDecisionComplete(
    suggestion: PriceSuggestion,
    message: string,
    productPriceChanged: boolean
  ) {
    setNotice(message);
    setSuggestions((current) => current.filter((item) => item.id !== suggestion.id));

    if (productPriceChanged) {
      void onProductsChanged();
    }
  }

  const emptyLabel = activeStatus === 'pending'
    ? 'No pending suggestions'
    : `No ${activeStatus} suggestions`;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
            <Sparkles className="h-4 w-4" />
            Human review workspace
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">Price Suggestions</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Review saved experimental pricing evidence. The synthetic price score is not confidence, accuracy, or a production outcome estimate.
          </p>
        </div>
        <button
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void loadSuggestions()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </section>

      <section className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm leading-6 text-indigo-950">
        <div className="flex gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" />
          <p>
            Suggestions use the saved Day 10 synthetic bootstrap score and generation-time competitor aggregate. Always review the evidence before deciding.
          </p>
        </div>
      </section>

      {notice ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          <div className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
          <button
            className="rounded-md p-1 transition hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            type="button"
            aria-label="Dismiss decision notification"
            onClick={() => setNotice('')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="suggestions-list-title">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="suggestions-list-title" className="font-bold text-slate-950">Suggestion queue</h3>
            <p className="mt-1 text-sm text-slate-500">Up to 20 most recent records for the selected status.</p>
          </div>
          <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1 sm:inline-flex" role="tablist" aria-label="Suggestion status">
            {STATUS_TABS.map((tab) => (
              <button
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  activeStatus === tab.value
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                type="button"
                role="tab"
                aria-selected={activeStatus === tab.value}
                key={tab.value}
                onClick={() => {
                  setActiveStatus(tab.value);
                  setNotice('');
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? <div className="p-4"><LoadingSkeleton /></div> : null}

        {!isLoading && loadError ? (
          <div className="p-5">
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900" role="alert">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-bold">Unable to load suggestions</p>
                  <p className="mt-1 text-sm">{loadError}</p>
                </div>
              </div>
              <button
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                type="button"
                onClick={() => void loadSuggestions()}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {!isLoading && !loadError && suggestions.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              <Sparkles className="h-6 w-6" />
            </div>
            <h4 className="mt-4 font-bold text-slate-950">{emptyLabel}</h4>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {activeStatus === 'pending'
                ? 'Generate a suggestion from an active product on the Overview workspace, then return here to review it.'
                : `No real ${activeStatus} records were returned by the API.`}
            </p>
          </div>
        ) : null}

        {!isLoading && !loadError && suggestions.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[1180px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Product</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Current</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Suggested</th>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Change</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Score</th>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Model</th>
                    <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Status / review</th>
                    <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-[0.08em] text-slate-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {suggestions.map((suggestion) => (
                    <tr className="transition hover:bg-slate-50" key={suggestion.id}>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-950">{suggestion.product.name}</p>
                        <p className="mt-1 text-xs text-slate-500">SKU {suggestion.product.sku}</p>
                        <span className="mt-2 inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">Experimental</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right text-slate-600">{formatInr(suggestion.current_price)}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-right font-bold text-slate-950">{formatInr(suggestion.suggested_price)}</td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <ActionLabel suggestion={suggestion} />
                        <p className="mt-1 text-xs text-slate-500">{formatPercentage(suggestion.percentage_change)}</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right font-semibold text-slate-800">
                        {suggestion.price_score === null ? '—' : suggestion.price_score.toFixed(2)}
                        <p className="mt-1 text-[11px] font-normal text-slate-500">Synthetic 0–100</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="max-w-44 truncate font-medium capitalize text-slate-800" title={suggestion.model_source || undefined}>{humanize(suggestion.model_source)}</p>
                        <p className="mt-1 max-w-44 truncate text-xs text-slate-500" title={suggestion.model_version || undefined}>{suggestion.model_version || 'Version unavailable'}</p>
                        <p className="mt-1 text-xs text-slate-500">{formatDateTime(suggestion.created_at)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={suggestion.status} />
                        {suggestion.status === 'approved' && suggestion.approved_at ? (
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            <p>{formatDateTime(suggestion.approved_at)}</p>
                            {suggestion.approved_by ? <p className="max-w-40 truncate" title={suggestion.approved_by}>User {suggestion.approved_by}</p> : null}
                          </div>
                        ) : null}
                        {getExpiresAt(suggestion) ? (
                          <p className="mt-2 text-xs leading-5 text-slate-500">
                            {suggestion.status === 'expired' ? 'Expired' : 'Expires'} {formatDateTime(getExpiresAt(suggestion))}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          type="button"
                          onClick={() => setSelectedSuggestionId(suggestion.id)}
                          aria-label={`Review suggestion for ${suggestion.product.name}`}
                        >
                          Review
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden">
              {suggestions.map((suggestion) => (
                <article className="p-4 sm:p-5" key={suggestion.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="truncate font-bold text-slate-950">{suggestion.product.name}</h4>
                      <p className="mt-1 text-xs text-slate-500">SKU {suggestion.product.sku}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={suggestion.status} />
                      <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">Experimental</span>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-slate-500">Current</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatInr(suggestion.current_price)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Suggested</p>
                      <p className="mt-1 font-bold text-indigo-800">{formatInr(suggestion.suggested_price)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Action / change</p>
                      <div className="mt-1"><ActionLabel suggestion={suggestion} /></div>
                      <p className="mt-1 text-xs text-slate-500">{formatPercentage(suggestion.percentage_change)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Synthetic score</p>
                      <p className="mt-1 font-semibold text-slate-800">{suggestion.price_score === null ? '—' : suggestion.price_score.toFixed(2)} / 100</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                    <p className="font-semibold capitalize text-slate-700">{humanize(suggestion.model_source)}</p>
                    <p>{suggestion.model_version || 'Version unavailable'} · {formatDateTime(suggestion.created_at)}</p>
                    {suggestion.status === 'approved' && suggestion.approved_at ? (
                      <>
                        <p className="mt-1">Reviewed {formatDateTime(suggestion.approved_at)}</p>
                        {suggestion.approved_by ? <p className="break-all">User {suggestion.approved_by}</p> : null}
                      </>
                    ) : null}
                    {getExpiresAt(suggestion) ? (
                      <p className="mt-1">
                        {suggestion.status === 'expired' ? 'Expired' : 'Expires'} {formatDateTime(getExpiresAt(suggestion))}
                      </p>
                    ) : null}
                  </div>
                  <button
                    className="mt-4 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    type="button"
                    onClick={() => setSelectedSuggestionId(suggestion.id)}
                  >
                    Review saved evidence
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <PriceSuggestionDetail
        suggestionId={selectedSuggestionId}
        accessToken={accessToken}
        canManage={canManage}
        onClose={() => setSelectedSuggestionId(null)}
        onUnauthorized={onUnauthorized}
        onRefreshList={() => void loadSuggestions()}
        onDecisionComplete={handleDecisionComplete}
      />
    </div>
  );
}
