import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  CompetitorTarget,
  Product,
  ScrapeJobStatus,
  ScrapeJobSummary,
  createCompetitorTarget,
  getCompetitorTargets,
  triggerTargetScrape,
  updateCompetitorTarget,
} from '../api/client';
import { formatInr } from '../utils/sales';
import JobStatusCard from './JobStatusCard';

type CompetitorTargetsDialogProps = {
  product: Product | null;
  isOpen: boolean;
  accessToken: string;
  canManage: boolean;
  queueAvailable: boolean;
  isQueueLoading: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onRefreshQueue: () => Promise<void> | void;
};

type FormMode = 'create' | 'edit';
type FieldErrors = { competitorName?: string; competitorUrl?: string };
type DialogNotice = { type: 'success' | 'error'; message: string };
type CurrentJob = {
  summary: ScrapeJobSummary;
  targetId: string;
  targetName: string;
};

function LoadingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading competitor targets" role="status">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5" key={index}>
          <div className="h-5 w-40 rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full rounded bg-slate-100" />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="h-16 rounded-xl bg-slate-100" />
            <div className="h-16 rounded-xl bg-slate-100" />
            <div className="h-16 rounded-xl bg-slate-100" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading configured competitor targets.</span>
    </div>
  );
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function validateForm(name: string, urlValue: string) {
  const errors: FieldErrors = {};
  const trimmedName = name.trim();
  const trimmedUrl = urlValue.trim();

  if (!trimmedName) {
    errors.competitorName = 'Enter a competitor name.';
  }

  if (!trimmedUrl) {
    errors.competitorUrl = 'Enter the exact product URL.';
  } else {
    try {
      const parsed = new URL(trimmedUrl);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.competitorUrl = 'Use an HTTP or HTTPS product URL.';
      } else if (parsed.username || parsed.password) {
        errors.competitorUrl = 'Remove the username or password from this URL.';
      }
    } catch {
      errors.competitorUrl = 'Enter a valid HTTP or HTTPS product URL.';
    }
  }

  return { errors, trimmedName, trimmedUrl };
}

export default function CompetitorTargetsDialog({
  product,
  isOpen,
  accessToken,
  canManage,
  queueAvailable,
  isQueueLoading,
  onClose,
  onUnauthorized,
  onRefreshQueue,
}: CompetitorTargetsDialogProps) {
  const [targets, setTargets] = useState<CompetitorTarget[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [mutationError, setMutationError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [togglingTargetId, setTogglingTargetId] = useState<string | null>(null);
  const [triggeringTargetId, setTriggeringTargetId] = useState<string | null>(null);
  const [notice, setNotice] = useState<DialogNotice | null>(null);
  const [currentJob, setCurrentJob] = useState<CurrentJob | null>(null);
  const [isJobTerminal, setIsJobTerminal] = useState(true);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const activeJobIdRef = useRef<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const criticalMutationRef = useRef(false);

  const handleApiError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.statusCode === 401) {
      onUnauthorized();
      return 'Session expired. Please sign in again.';
    }

    return error instanceof Error ? error.message : fallback;
  }, [onUnauthorized]);

  const loadTargets = useCallback(async ({ showSkeleton = true } = {}) => {
    if (!isOpen || !product) {
      return null;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    activeRequestRef.current = controller;

    if (showSkeleton) {
      setIsLoading(true);
    }
    setLoadError('');

    try {
      const result = await getCompetitorTargets(
        accessToken,
        product.id,
        controller.signal
      );

      if (!controller.signal.aborted && requestSequenceRef.current === sequence) {
        setTargets(result.items);
        return result.items;
      }
    } catch (error) {
      if (
        controller.signal.aborted
        || (error instanceof DOMException && error.name === 'AbortError')
        || requestSequenceRef.current !== sequence
      ) {
        return null;
      }

      setLoadError(handleApiError(error, 'Unable to load competitor targets.'));
    } finally {
      if (requestSequenceRef.current === sequence) {
        setIsLoading(false);
      }
    }

    return null;
  }, [accessToken, handleApiError, isOpen, product]);

  useEffect(() => {
    if (!isOpen || !product) {
      activeRequestRef.current?.abort();
      return undefined;
    }

    setTargets([]);
    setLoadError('');
    setFormMode(null);
    setEditingTargetId(null);
    setCompetitorName('');
    setCompetitorUrl('');
    setFieldErrors({});
    setMutationError('');
    setNotice(null);
    setCurrentJob(null);
    setIsJobTerminal(true);
    activeJobIdRef.current = null;
    void loadTargets();

    return () => {
      activeRequestRef.current?.abort();
    };
  }, [isOpen, loadTargets, product]);

  const isMutationCritical = isSaving
    || Boolean(togglingTargetId)
    || Boolean(triggeringTargetId);
  const hasRunningJob = Boolean(currentJob) && !isJobTerminal;

  useEffect(() => {
    criticalMutationRef.current = isMutationCritical;
  }, [isMutationCritical]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || criticalMutationRef.current) {
        return;
      }

      if (formMode) {
        setFormMode(null);
        setEditingTargetId(null);
        setMutationError('');
      } else {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [formMode, isOpen, onClose]);

  const handleJobTerminal = useCallback(async (job: ScrapeJobStatus, targetId: string) => {
    if (activeJobIdRef.current !== job.id) {
      return;
    }

    setIsJobTerminal(true);
    await onRefreshQueue();

    if (job.state === 'failed') {
      setNotice({
        type: 'error',
        message: `Job ${job.id} failed after ${job.attemptsMade} attempt${job.attemptsMade === 1 ? '' : 's'}.`,
      });
      return;
    }

    const refreshedTargets = await loadTargets({ showSkeleton: false });
    const refreshedTarget = refreshedTargets?.find((target) => target.id === targetId);
    const latest = refreshedTarget?.latestScrape;
    const priceMatches = latest && (
      job.result?.price === undefined || Number(latest.price) === job.result.price
    );
    const timestampMatches = latest && (
      job.result?.scrapedAt === undefined
      || new Date(latest.scrapedAt).getTime() === new Date(job.result.scrapedAt).getTime()
    );

    if (latest && priceMatches && timestampMatches) {
      setNotice({
        type: 'success',
        message: `Job ${job.id} completed. Latest trusted price: ${formatInr(latest.price)}.`,
      });
    } else {
      setNotice({
        type: 'error',
        message: `Job ${job.id} completed, but the refreshed trusted target row could not yet be confirmed.`,
      });
    }
  }, [loadTargets, onRefreshQueue]);

  if (!isOpen || !product) {
    return null;
  }

  const activeProduct = product;

  function focusForm() {
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  function openCreateForm() {
    if (!canManage) return;

    setFormMode('create');
    setEditingTargetId(null);
    setCompetitorName('');
    setCompetitorUrl('');
    setFieldErrors({});
    setMutationError('');
    setNotice(null);
    focusForm();
  }

  function openEditForm(target: CompetitorTarget) {
    if (!canManage) return;

    setFormMode('edit');
    setEditingTargetId(target.id);
    setCompetitorName(target.competitorName);
    setCompetitorUrl(target.competitorUrl);
    setFieldErrors({});
    setMutationError('');
    setNotice(null);
    focusForm();
  }

  function closeForm() {
    if (isSaving) {
      return;
    }
    setFormMode(null);
    setEditingTargetId(null);
    setFieldErrors({});
    setMutationError('');
  }

  async function handleSaveTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canManage || !formMode || isSaving) {
      return;
    }

    const validation = validateForm(competitorName, competitorUrl);
    setFieldErrors(validation.errors);
    setMutationError('');

    if (validation.errors.competitorName) {
      nameInputRef.current?.focus();
      return;
    }

    if (validation.errors.competitorUrl) {
      urlInputRef.current?.focus();
      return;
    }

    setIsSaving(true);

    try {
      if (formMode === 'create') {
        await createCompetitorTarget(accessToken, activeProduct.id, {
          competitorName: validation.trimmedName,
          competitorUrl: validation.trimmedUrl,
        });
        setNotice({ type: 'success', message: `${validation.trimmedName} was added.` });
      } else if (editingTargetId) {
        await updateCompetitorTarget(accessToken, activeProduct.id, editingTargetId, {
          competitorName: validation.trimmedName,
          competitorUrl: validation.trimmedUrl,
        });
        setNotice({ type: 'success', message: `${validation.trimmedName} was updated.` });
      }

      setFormMode(null);
      setEditingTargetId(null);
      await loadTargets({ showSkeleton: false });
    } catch (error) {
      setMutationError(handleApiError(error, 'Unable to save competitor target.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleTarget(target: CompetitorTarget) {
    if (!canManage || togglingTargetId || hasRunningJob) {
      return;
    }

    setTogglingTargetId(target.id);
    setNotice(null);

    try {
      await updateCompetitorTarget(accessToken, activeProduct.id, target.id, {
        isActive: !target.isActive,
      });
      setNotice({
        type: 'success',
        message: `${target.competitorName} was ${target.isActive ? 'deactivated' : 'activated'}.`,
      });
      await loadTargets({ showSkeleton: false });
    } catch (error) {
      setNotice({
        type: 'error',
        message: handleApiError(error, 'Unable to update target status.'),
      });
    } finally {
      setTogglingTargetId(null);
    }
  }

  async function handleTriggerTarget(target: CompetitorTarget) {
    if (
      triggeringTargetId
      || !canManage
      || hasRunningJob
      || !target.isActive
      || !queueAvailable
    ) {
      return;
    }

    setTriggeringTargetId(target.id);
    setNotice(null);

    try {
      const response = await triggerTargetScrape(accessToken, target.id);
      activeJobIdRef.current = response.job.id;
      setCurrentJob({
        summary: response.job,
        targetId: target.id,
        targetName: target.competitorName,
      });
      setIsJobTerminal(false);
      setNotice({
        type: 'success',
        message: `Job ${response.job.id} was queued for ${target.competitorName}.`,
      });
      await onRefreshQueue();
    } catch (error) {
      setNotice({
        type: 'error',
        message: handleApiError(error, 'Unable to enqueue target scrape.'),
      });
    } finally {
      setTriggeringTargetId(null);
    }
  }

  const activeJobTarget = currentJob
    ? targets.find((target) => target.id === currentJob.targetId)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="competitor-targets-dialog-title"
    >
      <button
        className="absolute inset-0 h-full w-full bg-slate-950/60 backdrop-blur-[1px]"
        type="button"
        aria-label="Close competitor targets dialog overlay"
        onClick={isMutationCritical ? undefined : onClose}
      />

      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:max-w-6xl sm:rounded-2xl sm:border sm:border-slate-200">
        <header className="z-20 flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Trusted competitors</p>
            <h2 id="competitor-targets-dialog-title" className="mt-1 truncate text-lg font-bold text-slate-950 sm:text-xl">
              {product.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              <span>SKU {product.sku}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-700">Current {formatInr(product.current_price)}</span>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            aria-label={`Close competitor targets for ${product.name}`}
            onClick={onClose}
            disabled={isMutationCritical}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="flex gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" />
              <p>Only active configured targets with an exact matching scrape influence pricing scores and suggestions.</p>
            </div>

            {isQueueLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking the scrape queue…
              </div>
            ) : !queueAvailable ? (
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">Scrape queue disconnected</p>
                  <p className="mt-1">
                    {canManage
                      ? 'Targets can still be managed, but “Scrape now” is disabled until Redis and the worker are available.'
                      : 'Saved targets remain available to review while Redis and the worker are unavailable.'}
                  </p>
                </div>
              </div>
            ) : null}

            {notice ? (
              <div
                className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                  notice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
                role={notice.type === 'error' ? 'alert' : 'status'}
              >
                <div className="flex gap-2">
                  {notice.type === 'success'
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>{notice.message}</span>
                </div>
                <button
                  className="rounded-md p-1 transition hover:bg-white/60 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  type="button"
                  aria-label="Dismiss competitor workspace notification"
                  onClick={() => setNotice(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-950">Configured targets</h3>
                <p className="mt-1 text-sm text-slate-500">One exact product URL per competitor for this product.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  onClick={() => void loadTargets()}
                  disabled={isLoading || isMutationCritical}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                {canManage ? (
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
                    type="button"
                    onClick={openCreateForm}
                    disabled={Boolean(formMode) || isMutationCritical || hasRunningJob}
                  >
                    <Plus className="h-4 w-4" />
                    Add target
                  </button>
                ) : null}
              </div>
            </div>

            {canManage && formMode ? (
              <form className="rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm sm:p-5" onSubmit={handleSaveTarget} noValidate>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">
                      {formMode === 'create' ? 'New trusted target' : 'Edit trusted target'}
                    </p>
                    <h3 className="mt-1 text-base font-bold text-slate-950">
                      {formMode === 'create' ? 'Add competitor mapping' : 'Update competitor mapping'}
                    </h3>
                  </div>
                  <button
                    className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    type="button"
                    aria-label="Close target form"
                    onClick={closeForm}
                    disabled={isSaving}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-slate-700" htmlFor="target-competitor-name">Competitor name</label>
                    <input
                      ref={nameInputRef}
                      className={`mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:ring-2 ${
                        fieldErrors.competitorName
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                          : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100'
                      }`}
                      id="target-competitor-name"
                      value={competitorName}
                      onChange={(event) => {
                        setCompetitorName(event.target.value);
                        setFieldErrors((current) => ({ ...current, competitorName: undefined }));
                      }}
                      disabled={isSaving}
                      aria-invalid={Boolean(fieldErrors.competitorName)}
                      aria-describedby={fieldErrors.competitorName ? 'target-name-error' : undefined}
                    />
                    {fieldErrors.competitorName ? <p id="target-name-error" className="mt-1.5 text-sm text-red-700">{fieldErrors.competitorName}</p> : null}
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700" htmlFor="target-competitor-url">Competitor URL</label>
                    <input
                      ref={urlInputRef}
                      className={`mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none transition focus:ring-2 ${
                        fieldErrors.competitorUrl
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                          : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100'
                      }`}
                      id="target-competitor-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://competitor.example/product"
                      value={competitorUrl}
                      onChange={(event) => {
                        setCompetitorUrl(event.target.value);
                        setFieldErrors((current) => ({ ...current, competitorUrl: undefined }));
                      }}
                      disabled={isSaving}
                      aria-invalid={Boolean(fieldErrors.competitorUrl)}
                      aria-describedby={fieldErrors.competitorUrl ? 'target-url-error' : undefined}
                    />
                    {fieldErrors.competitorUrl ? <p id="target-url-error" className="mt-1.5 text-sm text-red-700">{fieldErrors.competitorUrl}</p> : null}
                  </div>
                </div>

                {mutationError ? (
                  <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
                    {mutationError}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    type="button"
                    onClick={closeForm}
                    disabled={isSaving}
                  >
                    Cancel
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
                    type="submit"
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {isSaving ? 'Saving' : formMode === 'create' ? 'Add target' : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : null}

            {isLoading ? <LoadingSkeleton /> : null}

            {!isLoading && loadError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900" role="alert">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">Unable to load competitor targets</p>
                    <p className="mt-1 text-sm text-red-800">{loadError}</p>
                  </div>
                </div>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-800 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                  type="button"
                  onClick={() => void loadTargets()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              </div>
            ) : null}

            {!isLoading && !loadError && targets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
                  <Store className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-base font-bold text-slate-950">No competitor targets yet</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {canManage
                    ? 'Add an exact competitor product URL before running a trusted scrape.'
                    : 'No saved competitor targets are available for this product.'}
                </p>
                {canManage ? (
                  <button
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                    type="button"
                    onClick={openCreateForm}
                  >
                    <Plus className="h-4 w-4" />
                    Add first target
                  </button>
                ) : null}
              </div>
            ) : null}

            {!isLoading && !loadError && targets.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {targets.map((target) => {
                  const isToggling = togglingTargetId === target.id;
                  const isTriggering = triggeringTargetId === target.id;
                  const scrapeDisabled = !target.isActive
                    || !queueAvailable
                    || isTriggering
                    || hasRunningJob;

                  return (
                    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" key={target.id}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-bold text-slate-950">{target.competitorName}</h3>
                            <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                              target.isActive
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-600'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${target.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                              {target.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-slate-700">{getHostname(target.competitorUrl)}</p>
                          <p className="mt-1 break-all text-xs leading-5 text-slate-500">{target.competitorUrl}</p>
                        </div>
                        <a
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          href={target.competitorUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${target.competitorName} product page in a new tab`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Latest price</p>
                          <p className="mt-1 text-lg font-bold text-slate-950">{target.latestScrape ? formatInr(target.latestScrape.price) : '—'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Availability</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {target.latestScrape ? (target.latestScrape.isAvailable ? 'Available' : 'Unavailable') : 'No capture'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Last scraped</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {target.latestScrape ? formatTimestamp(target.latestScrape.scrapedAt) : 'Never scraped'}
                          </p>
                        </div>
                      </div>

                      {canManage ? (
                        <div className="mt-5 grid gap-2 sm:grid-cols-3">
                          <button
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            onClick={() => openEditForm(target)}
                            disabled={isMutationCritical || hasRunningJob}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            onClick={() => void handleToggleTarget(target)}
                            disabled={isMutationCritical || hasRunningJob}
                          >
                            {isToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                            {target.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
                            type="button"
                            onClick={() => void handleTriggerTarget(target)}
                            disabled={scrapeDisabled}
                            title={!target.isActive ? 'Activate this target before scraping.' : !queueAvailable ? 'The scrape queue is unavailable.' : hasRunningJob ? 'Wait for the current job to finish.' : undefined}
                          >
                            {isTriggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                            Scrape now
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            <JobStatusCard
              accessToken={accessToken}
              job={currentJob?.summary ?? null}
              targetId={currentJob?.targetId ?? null}
              targetName={currentJob?.targetName ?? ''}
              latestScrape={activeJobTarget?.latestScrape ?? null}
              onTerminal={handleJobTerminal}
              onUnauthorized={onUnauthorized}
            />

            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
              <Activity className="mt-0.5 h-4 w-4 shrink-0" />
              Queue results are shown from BullMQ. A price is presented as trusted only after the completed job and refreshed target data agree.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
