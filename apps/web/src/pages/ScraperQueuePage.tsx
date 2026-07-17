import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  ApiError,
  RecentScrapeJob,
  ScrapeJobState,
  ScrapeJobsResponse,
  ScraperStatusResponse,
  getScrapeJobs,
  retryScrapeJob,
} from '../api/client';
import QueueStatusPanel from '../components/QueueStatusPanel';

type Props = {
  accessToken: string;
  canManage: boolean;
  status: ScraperStatusResponse | null;
  statusError: string;
  isStatusLoading: boolean;
  isStatusRefreshing: boolean;
  lastRefreshedLabel: string;
  onRefreshStatus: () => void;
  onUnauthorized: () => void;
};

const JOBS_PER_PAGE = 20;
const POLL_INTERVAL_MS = 12000;
const states: Array<{ value: '' | ScrapeJobState; label: string }> = [
  { value: '', label: 'All states' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'active', label: 'Active' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

function stateClass(state: ScrapeJobState) {
  if (state === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (state === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  if (state === 'active') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (state === 'delayed') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function ScraperQueuePage({
  accessToken,
  canManage,
  status,
  statusError,
  isStatusLoading,
  isStatusRefreshing,
  lastRefreshedLabel,
  onRefreshStatus,
  onUnauthorized,
}: Props) {
  const [stateFilter, setStateFilter] = useState<'' | ScrapeJobState>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ScrapeJobsResponse | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load(silent = false) {
      if (!silent) setIsLoading(true);
      try {
        const next = await getScrapeJobs(accessToken, {
          state: stateFilter || undefined,
          page,
          limit: JOBS_PER_PAGE,
        }, controller.signal);
        if (!cancelled) {
          setResult(next);
          setError('');
        }
      } catch (loadError) {
        if (cancelled || controller.signal.aborted) return;
        if (loadError instanceof ApiError && loadError.statusCode === 401) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load recent jobs.');
      } finally {
        if (!cancelled && !silent) setIsLoading(false);
      }
    }

    void load();
    const intervalId = window.setInterval(() => void load(true), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [accessToken, onUnauthorized, page, refreshKey, stateFilter]);

  async function handleRetry(job: RecentScrapeJob) {
    setRetryingJobId(job.jobId);
    setError('');
    try {
      await retryScrapeJob(accessToken, job.jobId);
      setRefreshKey((value) => value + 1);
      onRefreshStatus();
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.statusCode === 401) {
        onUnauthorized();
      } else {
        setError(retryError instanceof Error ? retryError.message : 'Unable to retry job.');
      }
    } finally {
      setRetryingJobId(null);
    }
  }

  const jobs = result?.items ?? [];
  const pagination = result?.pagination;

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-indigo-700">Operations</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Scraper Queue</h2>
        <p className="mt-2 text-sm text-slate-600">Monitor queue health, worker scheduling, and retained scrape jobs.</p>
      </section>

      {!canManage ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950" role="status">
          Viewer access is read-only. Failed-job retries require manager or admin access.
        </div>
      ) : null}

      <QueueStatusPanel
        status={status}
        error={statusError}
        isLoading={isStatusLoading}
        isRefreshing={isStatusRefreshing}
        lastRefreshedLabel={lastRefreshedLabel}
        onRefresh={onRefreshStatus}
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h3 className="font-bold text-slate-950">Recent jobs</h3>
            <p className="mt-1 text-sm text-slate-500">Retained BullMQ jobs, newest first.</p>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Filter jobs by state"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              value={stateFilter}
              onChange={(event) => {
                setStateFilter(event.target.value as '' | ScrapeJobState);
                setPage(1);
              }}
            >
              {states.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              type="button"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="m-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button className="font-semibold underline" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading recent jobs
          </div>
        ) : jobs.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-500">No retained jobs match this state.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {jobs.map((job) => (
              <article className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] lg:items-center" key={job.jobId}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-lg border px-2.5 py-1 text-xs font-bold capitalize ${stateClass(job.state)}`}>{job.state}</span>
                    <span className="text-sm font-semibold text-slate-900">{job.competitorName || 'Configured target'}</span>
                  </div>
                  <p className="mt-2 truncate text-xs text-slate-500" title={job.jobId}>Job {job.jobId}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">Target {job.targetId || 'not linked'}</p>
                </div>
                <div className="text-sm text-slate-600">
                  <p className="font-semibold text-slate-800">Attempts {job.attemptsMade} / {job.maxAttempts}</p>
                  <p className="mt-1">Progress {job.progress === null ? 'Not reported' : `${job.progress}%`}</p>
                </div>
                <div className="text-xs text-slate-500">
                  <p>Queued: {formatTime(job.queuedAt)}</p>
                  <p className="mt-1">Processed: {formatTime(job.processedOn)}</p>
                  <p className="mt-1">Finished: {formatTime(job.finishedOn)}</p>
                  {job.failureReason ? <p className="mt-2 text-red-700">{job.failureReason}</p> : null}
                </div>
                {canManage && job.state === 'failed' ? (
                  <button
                    className="inline-flex w-fit items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    type="button"
                    disabled={retryingJobId === job.jobId || !job.targetId}
                    onClick={() => void handleRetry(job)}
                  >
                    {retryingJobId === job.jobId ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    Retry
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm sm:px-5">
            <span className="text-slate-500">Page {pagination.page} of {pagination.totalPages}</span>
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
