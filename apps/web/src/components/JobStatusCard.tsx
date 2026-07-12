import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  CompetitorData,
  Product,
  ScrapeJobStatus,
  ScrapeJobSummary,
  getScrapeJobStatus,
} from '../api/client';

type JobStatusCardProps = {
  accessToken: string;
  job: ScrapeJobSummary | null;
  product: Product | null;
  latestCompetitor: CompetitorData | null;
  onTerminal: (job: ScrapeJobStatus, product: Product) => void;
  onUnauthorized: () => void;
};

const POLL_INTERVAL_MS = 1800;
const MAX_POLL_MS = 120000;

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function getBadgeClass(state: string) {
  if (state === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (state === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700';
  }

  if (state === 'delayed') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }

  return 'border-indigo-200 bg-indigo-50 text-indigo-700';
}

function StatusIcon({ state }: { state: string }) {
  if (state === 'completed') {
    return <CheckCircle2 className="h-4 w-4" />;
  }

  if (state === 'failed') {
    return <XCircle className="h-4 w-4" />;
  }

  if (state === 'delayed') {
    return <Clock3 className="h-4 w-4" />;
  }

  return <Loader2 className="h-4 w-4 animate-spin" />;
}

export default function JobStatusCard({
  accessToken,
  job,
  product,
  latestCompetitor,
  onTerminal,
  onUnauthorized,
}: JobStatusCardProps) {
  const [currentJob, setCurrentJob] = useState<ScrapeJobStatus | null>(null);
  const [pollError, setPollError] = useState('');
  const activeJobIdRef = useRef<string | null>(null);
  const terminalNotifiedRef = useRef(false);

  useEffect(() => {
    if (!job || !product) {
      setCurrentJob(null);
      setPollError('');
      activeJobIdRef.current = null;
      return undefined;
    }

    const pollingJob = job;
    const pollingProduct = product;
    let timeoutId: number | undefined;
    let isCancelled = false;
    const startedAt = Date.now();
    activeJobIdRef.current = pollingJob.id;
    terminalNotifiedRef.current = false;
    setCurrentJob(null);
    setPollError('');

    async function poll() {
      if (isCancelled || activeJobIdRef.current !== pollingJob.id) {
        return;
      }

      try {
        const result = await getScrapeJobStatus(accessToken, pollingJob.id);

        if (isCancelled || activeJobIdRef.current !== pollingJob.id) {
          return;
        }

        setCurrentJob(result.job);

        const isTerminal = result.job.state === 'completed' || result.job.state === 'failed';

        if (isTerminal) {
          if (!terminalNotifiedRef.current) {
            terminalNotifiedRef.current = true;
            onTerminal(result.job, pollingProduct);
          }

          return;
        }

        if (Date.now() - startedAt >= MAX_POLL_MS) {
          setPollError('Polling stopped after two minutes. Refresh the job manually from the queue endpoint if needed.');
          return;
        }

        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (isCancelled || activeJobIdRef.current !== pollingJob.id) {
          return;
        }

        if (error instanceof ApiError && error.statusCode === 401) {
          onUnauthorized();
          return;
        }

        setPollError(error instanceof Error ? error.message : 'Unable to load job status');
        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();

    return () => {
      isCancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [accessToken, job, onTerminal, onUnauthorized, product]);

  if (!job || !product) {
    return null;
  }

  const displayJob = currentJob ?? {
    ...job,
    attemptsMade: 0,
    attemptsConfigured: 3,
    queuedAt: null,
    processedAt: null,
    finishedAt: null,
  };
  const resultPrice = displayJob.result?.price;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="job-status-title">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Current job</p>
          <h2 id="job-status-title" className="mt-1 text-base font-bold text-slate-950">
            {product.name}
          </h2>
          <p className="mt-1 text-sm text-slate-500">SKU {product.sku}</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold ${getBadgeClass(displayJob.state)}`}>
          <StatusIcon state={displayJob.state} />
          {displayJob.state}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Job ID</p>
          <p className="mt-1 break-all text-sm font-semibold text-slate-800">{displayJob.id}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Attempts</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {displayJob.attemptsMade} / {displayJob.attemptsConfigured}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Finished</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {displayJob.finishedAt ? new Date(displayJob.finishedAt).toLocaleString() : 'Pending'}
          </p>
        </div>
      </div>

      {displayJob.state === 'completed' ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Completed
          {resultPrice !== undefined ? ` · parsed ${currencyFormatter.format(resultPrice)}` : ''}
          {displayJob.result?.competitorName ? ` · ${displayJob.result.competitorName}` : ''}
        </div>
      ) : null}

      {displayJob.state === 'failed' ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{displayJob.failureReason || 'The scrape job failed.'}</span>
        </div>
      ) : null}

      {pollError ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {pollError}
        </div>
      ) : null}

      {latestCompetitor ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <p className="font-semibold text-slate-800">Latest competitor row</p>
          <p className="mt-1 text-slate-600">
            {latestCompetitor.competitor_name} · {currencyFormatter.format(Number(latestCompetitor.price))} ·{' '}
            {new Date(latestCompetitor.scraped_at).toLocaleString()}
          </p>
        </div>
      ) : null}
    </section>
  );
}
