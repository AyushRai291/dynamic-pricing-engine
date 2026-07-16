import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  CompetitorTargetLatestScrape,
  ScrapeJobStatus,
  ScrapeJobSummary,
  getScrapeJobStatus,
} from '../api/client';
import { formatInr } from '../utils/sales';

type JobStatusCardProps = {
  accessToken: string;
  job: ScrapeJobSummary | null;
  targetId: string | null;
  targetName: string;
  latestScrape: CompetitorTargetLatestScrape | null;
  onTerminal: (job: ScrapeJobStatus, targetId: string) => void;
  onUnauthorized: () => void;
};

const POLL_INTERVAL_MS = 1800;
const MAX_POLL_MS = 120000;

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

function sanitizeFailureReason(reason?: string) {
  if (!reason) {
    return 'The scrape could not be completed after its configured retries.';
  }

  const safeReasons = [
    'Price could not be parsed from HTML',
    'Product not found',
    'competitorUrl host is not allowed',
  ];

  return safeReasons.some((safeReason) => reason.includes(safeReason))
    ? reason
    : 'The scrape could not be completed after its configured retries.';
}

export default function JobStatusCard({
  accessToken,
  job,
  targetId,
  targetName,
  latestScrape,
  onTerminal,
  onUnauthorized,
}: JobStatusCardProps) {
  const [currentJob, setCurrentJob] = useState<ScrapeJobStatus | null>(null);
  const [pollError, setPollError] = useState('');
  const activeJobIdRef = useRef<string | null>(null);
  const terminalNotifiedRef = useRef(false);

  useEffect(() => {
    if (!job || !targetId) {
      setCurrentJob(null);
      setPollError('');
      activeJobIdRef.current = null;
      return undefined;
    }

    const pollingJob = job;
    const pollingTargetId = targetId;
    const controller = new AbortController();
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
        const result = await getScrapeJobStatus(
          accessToken,
          pollingJob.id,
          controller.signal
        );

        if (isCancelled || activeJobIdRef.current !== pollingJob.id) {
          return;
        }

        setCurrentJob(result.job);
        const isTerminal = result.job.state === 'completed' || result.job.state === 'failed';

        if (isTerminal) {
          if (!terminalNotifiedRef.current) {
            terminalNotifiedRef.current = true;
            onTerminal(result.job, pollingTargetId);
          }
          return;
        }

        if (Date.now() - startedAt >= MAX_POLL_MS) {
          setPollError('Polling stopped after two minutes. The queue may still finish this job.');
          return;
        }

        timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (
          isCancelled
          || controller.signal.aborted
          || (error instanceof DOMException && error.name === 'AbortError')
          || activeJobIdRef.current !== pollingJob.id
        ) {
          return;
        }

        if (error instanceof ApiError && error.statusCode === 401) {
          onUnauthorized();
          return;
        }

        setPollError(error instanceof Error ? error.message : 'Unable to load job status.');

        if (Date.now() - startedAt < MAX_POLL_MS) {
          timeoutId = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    void poll();

    return () => {
      isCancelled = true;
      controller.abort();
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [accessToken, job, onTerminal, onUnauthorized, targetId]);

  if (!job || !targetId) {
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

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="target-job-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Latest queue job</p>
          <h3 id="target-job-title" className="mt-1 truncate text-base font-bold text-slate-950">
            {targetName}
          </h3>
          <p className="mt-1 break-all text-xs text-slate-500">Job ID {displayJob.id}</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold capitalize ${getBadgeClass(displayJob.state)}`}>
          <StatusIcon state={displayJob.state} />
          {displayJob.state}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
        <div className="mt-4 space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          <p className="font-semibold">Queue job completed.</p>
          {displayJob.result?.price !== undefined ? (
            <p>Parsed response: {formatInr(displayJob.result.price)}</p>
          ) : null}
          {latestScrape ? (
            <p>Latest trusted target price: {formatInr(latestScrape.price)}</p>
          ) : (
            <p>The latest target row is being confirmed.</p>
          )}
        </div>
      ) : null}

      {displayJob.state === 'failed' ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{sanitizeFailureReason(displayJob.failureReason)}</span>
        </div>
      ) : null}

      {pollError ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          {pollError}
        </div>
      ) : null}
    </section>
  );
}
