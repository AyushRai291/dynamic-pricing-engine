import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  PackageOpen,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';

import {
  ApiError,
  BulkProductSalesRecord,
  BulkProductSalesResponse,
  Product,
  ProductSalesHistoryResponse,
  bulkUpsertProductSales,
  getProductSalesHistory,
} from '../api/client';
import { formatInr, getLocalIsoDate, isStrictIsoDate } from '../utils/sales';
import BulkSalesEntryForm from './BulkSalesEntryForm';
import SalesDateFilters, { SalesDateFilterValues } from './SalesDateFilters';
import SalesHistoryOverview from './SalesHistoryOverview';

type SalesHistoryDialogProps = {
  product: Product | null;
  isOpen: boolean;
  accessToken: string;
  canManage: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
};

const HISTORY_LIMIT = 90;
const EMPTY_FILTERS: SalesDateFilterValues = { from: '', to: '' };

function getFilterError(filters: SalesDateFilterValues, today: string): string {
  for (const [label, value] of [['From', filters.from], ['To', filters.to]] as const) {
    if (value && !isStrictIsoDate(value)) {
      return `${label} must use a valid YYYY-MM-DD date.`;
    }

    if (value > today) {
      return `${label} date cannot be in the future.`;
    }
  }

  if (filters.from && filters.to && filters.from > filters.to) {
    return 'From date must be before or equal to To date.';
  }

  return '';
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading sales history" role="status">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-100" key={index} />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
      <span className="sr-only">Loading daily sales and revenue history.</span>
    </div>
  );
}

export default function SalesHistoryDialog({
  product,
  isOpen,
  accessToken,
  canManage,
  onClose,
  onUnauthorized,
}: SalesHistoryDialogProps) {
  const [history, setHistory] = useState<ProductSalesHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draftFilters, setDraftFilters] = useState<SalesDateFilterValues>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<SalesDateFilterValues>(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState('');
  const [isEntryOpen, setIsEntryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isSavingRef = useRef(false);
  const today = getLocalIsoDate();

  const loadHistory = useCallback(async (filters: SalesDateFilterValues) => {
    if (!isOpen || !product) {
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    activeRequestRef.current = controller;
    setIsLoading(true);
    setLoadError('');
    setHistory(null);

    try {
      const result = await getProductSalesHistory(
        accessToken,
        product.id,
        {
          from: filters.from || undefined,
          to: filters.to || undefined,
          limit: HISTORY_LIMIT,
        },
        controller.signal
      );

      if (!controller.signal.aborted && requestSequenceRef.current === requestSequence) {
        setHistory(result);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }

      setLoadError(error instanceof Error ? error.message : 'Unable to load sales history.');
    } finally {
      if (requestSequenceRef.current === requestSequence) {
        setIsLoading(false);
      }
    }
  }, [accessToken, isOpen, onUnauthorized, product]);

  useEffect(() => {
    if (!isOpen || !product) {
      activeRequestRef.current?.abort();
      return undefined;
    }

    setHistory(null);
    setLoadError('');
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setFilterError('');
    setIsEntryOpen(false);
    setIsSaving(false);
    setSuccessMessage('');
    void loadHistory(EMPTY_FILTERS);

    return () => {
      activeRequestRef.current?.abort();
    };
  }, [isOpen, loadHistory, product]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSavingRef.current) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const records = product && history?.productId === product.id ? history.items : [];

  if (!isOpen || !product) {
    return null;
  }

  const activeProduct = product;
  const hasAppliedFilters = Boolean(appliedFilters.from || appliedFilters.to);

  function handleApplyFilters() {
    const validationError = getFilterError(draftFilters, today);
    setFilterError(validationError);

    if (validationError) {
      return;
    }

    const nextFilters = { ...draftFilters };
    setAppliedFilters(nextFilters);
    setSuccessMessage('');
    void loadHistory(nextFilters);
  }

  function handleResetFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setFilterError('');
    setSuccessMessage('');
    void loadHistory(EMPTY_FILTERS);
  }

  async function handleSaveRecords(recordsToSave: BulkProductSalesRecord[]) {
    if (!canManage) {
      throw new Error('Manager or admin access is required to add sales records.');
    }

    setSuccessMessage('');

    try {
      return await bulkUpsertProductSales(accessToken, activeProduct.id, { records: recordsToSave });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
      }

      throw error;
    }
  }

  function handleRecordsSaved(result: BulkProductSalesResponse) {
    const label = result.upsertedCount === 1 ? 'record' : 'records';
    setSuccessMessage(`${result.upsertedCount} sales ${label} saved successfully.`);
    setIsEntryOpen(false);
    void loadHistory(appliedFilters);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sales-history-dialog-title"
    >
      <button
        className="absolute inset-0 h-full w-full bg-slate-950/60 backdrop-blur-[1px]"
        type="button"
        aria-label="Close sales history dialog overlay"
        onClick={isSaving ? undefined : onClose}
      />

      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-slate-200">
        <header className="sticky top-0 z-20 flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Product sales</p>
            <h2 id="sales-history-dialog-title" className="mt-1 truncate text-lg font-bold text-slate-950 sm:text-xl">
              {product.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span>SKU {product.sku}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-700">Current {formatInr(product.current_price)}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">Daily sales and revenue history</p>
          </div>
          <button
            ref={closeButtonRef}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            aria-label={`Close sales history for ${product.name}`}
            onClick={onClose}
            disabled={isSaving}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-6xl space-y-5">
            {successMessage ? (
              <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
                <div className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{successMessage} History has been refreshed.</span>
                </div>
                <button
                  className="rounded-md p-1 transition hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  type="button"
                  aria-label="Dismiss sales success message"
                  onClick={() => setSuccessMessage('')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <SalesDateFilters
              values={draftFilters}
              today={today}
              limit={HISTORY_LIMIT}
              error={filterError}
              isLoading={isLoading}
              hasAppliedFilters={hasAppliedFilters}
              onChange={(values) => {
                setDraftFilters(values);
                setFilterError('');
              }}
              onApply={handleApplyFilters}
              onReset={handleResetFilters}
            />

            {canManage ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Daily sales entry</p>
                    <p className="mt-1 text-sm text-slate-500">Record real sold units and the actual selling price.</p>
                  </div>
                  {!isEntryOpen ? (
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:ring-offset-2"
                      type="button"
                      onClick={() => {
                        setIsEntryOpen(true);
                        setSuccessMessage('');
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Add daily sales
                    </button>
                  ) : null}
                </div>

                {isEntryOpen ? (
                  <BulkSalesEntryForm
                    onSave={handleSaveRecords}
                    onSaved={handleRecordsSaved}
                    onCancel={() => setIsEntryOpen(false)}
                    onSavingChange={setIsSaving}
                  />
                ) : null}
              </>
            ) : null}

            {isLoading ? <LoadingSkeleton /> : null}

            {!isLoading && loadError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm" role="alert">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">Unable to load sales history</p>
                    <p className="mt-1 text-sm text-red-800">{loadError}</p>
                  </div>
                </div>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                  type="button"
                  onClick={() => loadHistory(appliedFilters)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              </div>
            ) : null}

            {!isLoading && !loadError && records.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                  <PackageOpen className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-950">
                  {hasAppliedFilters ? 'No sales in this date range' : 'No sales history yet'}
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {hasAppliedFilters
                    ? 'Reset the filters or choose another period. No missing dates are inferred.'
                    : canManage
                      ? 'Add the first real daily sales record for this product. Zero-sales days are valid.'
                      : 'No sales records are available for this product yet.'}
                </p>
              </div>
            ) : null}

            {!isLoading && !loadError && records.length > 0 ? <SalesHistoryOverview records={records} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
