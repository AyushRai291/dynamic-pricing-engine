import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ServerCog } from 'lucide-react';

import { ScraperStatusResponse } from '../api/client';

type QueueStatusPanelProps = {
  status: ScraperStatusResponse | null;
  error: string;
  isLoading: boolean;
  isRefreshing: boolean;
  lastRefreshedLabel: string;
  onRefresh: () => void;
};

function CountTile({ label, value, tone = 'slate' }: { label: string; value: number | string; tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'indigo' }) {
  const toneClass = {
    slate: 'text-slate-950',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    indigo: 'text-indigo-700',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${toneClass}`}>{value}</p>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" key={index} />
        ))}
      </div>
    </div>
  );
}

export default function QueueStatusPanel({
  status,
  error,
  isLoading,
  isRefreshing,
  lastRefreshedLabel,
  onRefresh,
}: QueueStatusPanelProps) {
  if (isLoading && !status && !error) {
    return <QueueSkeleton />;
  }

  const queue = status?.queue;
  const scheduler = status?.scheduler;
  const isConnected = Boolean(queue?.available) && !error;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="queue-status-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
              <ServerCog className="h-5 w-5" />
            </div>
            <div>
              <h2 id="queue-status-title" className="text-base font-bold text-slate-950">
                Scraper Queue Health
              </h2>
              <p className="text-sm text-slate-500">
                {queue?.name ? `Queue: ${queue.name}` : 'Queue metadata unavailable'}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-semibold ${
                isConnected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {isConnected ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {isConnected ? 'Redis connected' : 'Redis disconnected'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-medium text-slate-600">
              <Clock3 className="h-4 w-4" />
              Last refreshed {lastRefreshedLabel}
            </span>
          </div>
        </div>

        <button
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing' : 'Refresh status'}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <CountTile label="Waiting" value={queue?.waiting ?? '—'} tone="indigo" />
        <CountTile label="Active" value={queue?.active ?? '—'} tone="emerald" />
        <CountTile label="Delayed" value={queue?.delayed ?? '—'} tone="amber" />
        <CountTile label="Completed" value={queue?.completed ?? '—'} tone="slate" />
        <CountTile label="Failed" value={queue?.failed ?? '—'} tone={queue?.failed ? 'red' : 'slate'} />
        <CountTile label="Paused" value={queue?.paused ?? '—'} tone="slate" />
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="font-semibold text-slate-700">Scheduler</p>
          <p className="mt-1 text-slate-600">
            {scheduler ? (scheduler.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}
            {scheduler?.expression ? ` · ${scheduler.expression}` : ''}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="font-semibold text-slate-700">Worker</p>
          <p className="mt-1 text-slate-600">
            {status?.worker ? `${status.worker.status} · concurrency ${status.worker.concurrency}` : 'Unavailable'}
          </p>
        </div>
      </div>
    </section>
  );
}
