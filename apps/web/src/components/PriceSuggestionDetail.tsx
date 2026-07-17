import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  PriceSuggestion,
  approvePriceSuggestion,
  generatePriceSuggestionRationale,
  getPriceSuggestion,
  rejectPriceSuggestion,
} from '../api/client';
import { formatInr } from '../utils/sales';

type DecisionKind = 'approve' | 'reject';
type ActiveAction = 'rationale' | DecisionKind;

type PriceSuggestionDetailProps = {
  suggestionId: string | null;
  accessToken: string;
  canManage: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onRefreshList: () => void;
  onDecisionComplete: (
    suggestion: PriceSuggestion,
    message: string,
    productPriceChanged: boolean
  ) => void;
};

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
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
}

function humanize(value: string | null) {
  return value ? value.replaceAll('_', ' ') : 'Not available';
}

function ActionIcon({ action }: { action: PriceSuggestion['action'] }) {
  if (action === 'increase') {
    return <ArrowUpRight className="h-4 w-4" />;
  }

  if (action === 'decrease') {
    return <ArrowDownRight className="h-4 w-4" />;
  }

  return <ArrowRight className="h-4 w-4" />;
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

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold capitalize text-slate-900">{value}</dd>
    </div>
  );
}

function DecisionConfirmation({
  kind,
  suggestion,
}: {
  kind: DecisionKind;
  suggestion: PriceSuggestion;
}) {
  const isApproval = kind === 'approve';

  return (
    <div
      className={`rounded-xl border p-4 ${
        isApproval
          ? 'border-indigo-200 bg-indigo-50 text-indigo-950'
          : 'border-red-200 bg-red-50 text-red-950'
      }`}
      role="alert"
    >
      <div className="flex gap-3">
        {isApproval ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
        )}
        <div>
          <p className="font-bold">
            {isApproval ? 'Confirm this price change' : 'Confirm suggestion rejection'}
          </p>
          {isApproval ? (
            <>
              <p className="mt-2 text-sm">
                {formatInr(suggestion.current_price)} to {formatInr(suggestion.suggested_price)}{' '}
                ({formatPercentage(suggestion.percentage_change)}).
              </p>
              <p className="mt-1 text-sm leading-6">
                The product current price will be updated and one price-history audit row will be recorded.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm leading-6">
              The product price will remain unchanged and no price-history row will be created.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5" aria-label="Loading price suggestion" role="status">
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="h-28 animate-pulse rounded-xl bg-slate-100" key={index} />
        ))}
      </div>
      <div className="h-52 animate-pulse rounded-xl bg-slate-100" />
      <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      <span className="sr-only">Loading saved suggestion evidence.</span>
    </div>
  );
}

export default function PriceSuggestionDetail({
  suggestionId,
  accessToken,
  canManage,
  onClose,
  onUnauthorized,
  onRefreshList,
  onDecisionComplete,
}: PriceSuggestionDetailProps) {
  const [suggestion, setSuggestion] = useState<PriceSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [confirmation, setConfirmation] = useState<DecisionKind | null>(null);
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const activeRequestRef = useRef<AbortController | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const isBusyRef = useRef(false);

  const loadSuggestion = useCallback(async () => {
    if (!suggestionId) {
      return;
    }

    activeRequestRef.current?.abort();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsLoading(true);
    setLoadError('');

    try {
      const result = await getPriceSuggestion(accessToken, suggestionId, controller.signal);

      if (!controller.signal.aborted) {
        setSuggestion(result.suggestion);
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }

      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }

      setLoadError(error instanceof Error ? error.message : 'Unable to load this suggestion.');
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [accessToken, onUnauthorized, suggestionId]);

  useEffect(() => {
    if (!suggestionId) {
      activeRequestRef.current?.abort();
      setSuggestion(null);
      return undefined;
    }

    setSuggestion(null);
    setConfirmation(null);
    setActionError('');
    setSuccessMessage('');
    void loadSuggestion();

    return () => {
      activeRequestRef.current?.abort();
    };
  }, [loadSuggestion, suggestionId]);

  useEffect(() => {
    isBusyRef.current = activeAction !== null;
  }, [activeAction]);

  useEffect(() => {
    if (!suggestionId) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBusyRef.current) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, suggestionId]);

  async function handleGenerateRationale() {
    if (!canManage || !suggestion || activeAction) {
      return;
    }

    setActiveAction('rationale');
    setActionError('');
    setSuccessMessage('');

    try {
      const result = await generatePriceSuggestionRationale(accessToken, suggestion.id);
      setSuggestion((current) => current ? { ...current, aiRationale: result.rationale } : current);
      setSuccessMessage(result.generated ? 'AI rationale generated and saved.' : 'Saved AI rationale loaded.');
      onRefreshList();
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }

      if (error instanceof ApiError && error.statusCode === 503) {
        setActionError(
          /not configured/i.test(error.message)
            ? 'AI rationale generation is not configured on the server.'
            : 'The AI rationale provider is unavailable. Approval and rejection are still available.'
        );
        return;
      }

      setActionError(error instanceof Error ? error.message : 'Unable to generate AI rationale.');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleDecision(kind: DecisionKind) {
    if (!canManage || !suggestion || suggestion.status !== 'pending' || activeAction) {
      return;
    }

    setActiveAction(kind);
    setActionError('');
    setSuccessMessage('');

    try {
      if (kind === 'approve') {
        const result = await approvePriceSuggestion(accessToken, suggestion.id);
        setSuggestion(result.suggestion);
        setSuccessMessage('Price change approved. The product and price history were updated.');
        onDecisionComplete(
          result.suggestion,
          `${result.suggestion.product.name} was approved at ${formatInr(result.new_price)}.`,
          true
        );
      } else {
        const result = await rejectPriceSuggestion(accessToken, suggestion.id);
        setSuggestion(result.suggestion);
        setSuccessMessage('Suggestion rejected. The product price was not changed.');
        onDecisionComplete(
          result.suggestion,
          `${result.suggestion.product.name} suggestion was rejected.`,
          false
        );
      }

      setConfirmation(null);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }

      if (error instanceof ApiError && error.statusCode === 409) {
        setConfirmation(null);
        setActionError(`${error.message} The latest suggestion state is being loaded.`);
        await loadSuggestion();
        onRefreshList();
        return;
      }

      setActionError(error instanceof Error ? error.message : `Unable to ${kind} this suggestion.`);
    } finally {
      setActiveAction(null);
    }
  }

  if (!suggestionId) {
    return null;
  }

  const isBusy = activeAction !== null;
  const rationale = suggestion?.aiRationale;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="price-suggestion-dialog-title"
    >
      <button
        className="absolute inset-0 h-full w-full bg-slate-950/60 backdrop-blur-[1px]"
        type="button"
        aria-label="Close price suggestion detail overlay"
        onClick={isBusy ? undefined : onClose}
      />

      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-h-[92vh] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-slate-200">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">
              Saved pricing evidence
            </p>
            <h2 id="price-suggestion-dialog-title" className="mt-1 truncate text-lg font-bold text-slate-950 sm:text-xl">
              {suggestion?.product.name || 'Price suggestion'}
            </h2>
            {suggestion ? (
              <p className="mt-1 text-sm text-slate-500">SKU {suggestion.product.sku}</p>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            aria-label="Close price suggestion detail"
            onClick={onClose}
            disabled={isBusy}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6 sm:py-6">
          <div className="mx-auto max-w-5xl space-y-5">
            {isLoading && !suggestion ? <DetailSkeleton /> : null}

            {!isLoading && loadError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900" role="alert">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-bold">Unable to load suggestion</p>
                    <p className="mt-1 text-sm">{loadError}</p>
                  </div>
                </div>
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
                  type="button"
                  onClick={() => void loadSuggestion()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </button>
              </div>
            ) : null}

            {suggestion ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={suggestion.status} />
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-800">
                    <Sparkles className="h-3.5 w-3.5" />
                    Experimental bootstrap
                  </span>
                </div>

                {successMessage ? (
                  <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                ) : null}

                {actionError ? (
                  <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                ) : null}

                <section className="grid gap-3 sm:grid-cols-3" aria-label="Price change summary">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Saved current price</p>
                    <p className="mt-2 text-xl font-bold text-slate-950">{formatInr(suggestion.current_price)}</p>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-700">Suggested price</p>
                    <p className="mt-2 text-xl font-bold text-indigo-950">{formatInr(suggestion.suggested_price)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Percentage change</p>
                    <p className="mt-2 flex items-center gap-1 text-xl font-bold text-slate-950">
                      <ActionIcon action={suggestion.action} />
                      {formatPercentage(suggestion.percentage_change)}
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="saved-evidence-title">
                  <div className="flex items-start gap-3">
                    <Info className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                    <div>
                      <h3 id="saved-evidence-title" className="font-bold text-slate-950">Saved suggestion evidence</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        This is the generation-time snapshot. It is not replaced with newer competitor data.
                      </p>
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <EvidenceItem label="Action" value={humanize(suggestion.action)} />
                    <EvidenceItem
                      label="Price score (0-100)"
                      value={suggestion.price_score === null ? 'Not available' : suggestion.price_score.toFixed(2)}
                    />
                    <EvidenceItem label="Raw candidate" value={formatInr(suggestion.raw_candidate)} />
                    <EvidenceItem label="Model source" value={humanize(suggestion.model_source)} />
                    <EvidenceItem label="Model version" value={suggestion.model_version || 'Not available'} />
                    <EvidenceItem label="Created" value={formatDateTime(suggestion.created_at)} />
                    <EvidenceItem
                      label="Competitors captured"
                      value={`${suggestion.competitor_snapshot.available_count} available of ${suggestion.competitor_snapshot.count}`}
                    />
                    <EvidenceItem
                      label="Average available price"
                      value={formatInr(suggestion.competitor_snapshot.average_price)}
                    />
                    <EvidenceItem
                      label="Applied guardrails"
                      value={suggestion.applied_guardrails.length > 0
                        ? suggestion.applied_guardrails.map(humanize).join(', ')
                        : 'None applied'}
                    />
                  </dl>

                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                    <span className="font-bold">Experimental limitation: </span>
                    {suggestion.limitation}
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="rationale-title">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 id="rationale-title" className="font-bold text-slate-950">AI rationale</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        Optional explanation of the saved evidence; it does not choose or change the price.
                      </p>
                    </div>
                    {canManage && !rationale && suggestion.status === 'pending' ? (
                      <button
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-800 transition hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                        type="button"
                        onClick={() => void handleGenerateRationale()}
                        disabled={isBusy}
                      >
                        {activeAction === 'rationale' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {activeAction === 'rationale' ? 'Generating rationale' : 'Generate AI rationale'}
                      </button>
                    ) : null}
                  </div>

                  {rationale ? (
                    <div className="mt-5 space-y-5 text-sm text-slate-700">
                      <div>
                        <h4 className="font-bold text-slate-950">Summary</h4>
                        <p className="mt-2 leading-6">{rationale.summary}</p>
                      </div>
                      <div className="grid gap-5 md:grid-cols-2">
                        <div>
                          <h4 className="font-bold text-slate-950">Key factors</h4>
                          {rationale.keyFactors.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-2 pl-5 leading-6">
                              {rationale.keyFactors.map((factor) => <li key={factor}>{factor}</li>)}
                            </ul>
                          ) : <p className="mt-2 text-slate-500">No key factors were returned.</p>}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-950">Risks</h4>
                          {rationale.risks.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-2 pl-5 leading-6">
                              {rationale.risks.map((risk) => <li key={risk}>{risk}</li>)}
                            </ul>
                          ) : <p className="mt-2 text-slate-500">No risks were returned.</p>}
                        </div>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-950">Guardrail explanation</h4>
                        <p className="mt-2 leading-6">{rationale.guardrailExplanation}</p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 leading-6 text-amber-950">
                        <span className="font-bold">Mandatory limitation: </span>{rationale.limitation}
                      </div>
                      <p className="text-xs text-slate-500">
                        Generated {formatDateTime(rationale.generatedAt)} by {rationale.provider} / {rationale.model}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                      {suggestion.status === 'pending'
                        ? canManage
                          ? 'No AI rationale has been saved. You can still approve or reject this suggestion.'
                          : 'No AI rationale has been saved for this suggestion.'
                        : 'No AI rationale was saved before this suggestion was decided.'}
                    </div>
                  )}
                </section>

                {suggestion.status === 'approved' ? (
                  <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
                    <div className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <h3 className="font-bold">Approved price change</h3>
                        <p className="mt-1 text-sm">Reviewed {formatDateTime(suggestion.approved_at)}</p>
                        {suggestion.approved_by ? <p className="mt-1 break-all text-sm">Approving user: {suggestion.approved_by}</p> : null}
                      </div>
                    </div>
                  </section>
                ) : null}

                {suggestion.status === 'rejected' ? (
                  <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-950">
                    <div className="flex gap-3">
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <h3 className="font-bold">Suggestion rejected</h3>
                        <p className="mt-1 text-sm">The product price was not changed and no price-history row was created.</p>
                      </div>
                    </div>
                  </section>
                ) : null}

                {canManage && confirmation ? <DecisionConfirmation kind={confirmation} suggestion={suggestion} /> : null}
              </>
            ) : null}
          </div>
        </div>

        {canManage && suggestion?.status === 'pending' ? (
          <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              {confirmation ? (
                <>
                  <button
                    className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    type="button"
                    onClick={() => setConfirmation(null)}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                  <button
                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                      confirmation === 'approve'
                        ? 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500'
                        : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                    }`}
                    type="button"
                    onClick={() => void handleDecision(confirmation)}
                    disabled={isBusy}
                  >
                    {activeAction === confirmation ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {activeAction === confirmation
                      ? 'Saving decision'
                      : confirmation === 'approve'
                        ? 'Confirm approval'
                        : 'Confirm rejection'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                    type="button"
                    onClick={() => {
                      setActionError('');
                      setConfirmation('reject');
                    }}
                    disabled={isBusy}
                  >
                    <XCircle className="h-4 w-4" />
                    Reject suggestion
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
                    type="button"
                    onClick={() => {
                      setActionError('');
                      setConfirmation('approve');
                    }}
                    disabled={isBusy}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Approve price change
                  </button>
                </>
              )}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
