import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2, RefreshCw, ServerCog, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  ApiError,
  ApiHealthResponse,
  AuthUser,
  PricingStatusResponse,
  ScraperStatusResponse,
  getApiHealth,
  getPricingStatus,
  getScraperStatus,
} from '../api/client';
import AdminUserManagement from '../components/AdminUserManagement';

type Props = {
  accessToken: string;
  user: AuthUser;
  onUnauthorized: () => void;
};

type SystemState = {
  api: ApiHealthResponse | null;
  pricing: PricingStatusResponse | null;
  scraper: ScraperStatusResponse | null;
  errors: { api?: string; pricing?: string; scraper?: string };
};

const permissionText = {
  viewer: 'Read-only access to authenticated operational workspaces.',
  manager: 'Operational read/write access, excluding user-role administration.',
  admin: 'Operational access plus secure user-role administration.',
};

function StatusCard({ title, icon: Icon, available, children, error }: { title: string; icon: typeof ServerCog; available: boolean; children: React.ReactNode; error?: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Icon className="h-5 w-5 text-indigo-700" /><h3 className="font-bold text-slate-950">{title}</h3></div><span className={`rounded-md border px-2 py-1 text-xs font-bold ${available ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{available ? 'Available' : 'Unavailable'}</span></div>
      <div className="mt-4 text-sm text-slate-600">{children}</div>
      {error ? <p className="mt-3 text-xs text-amber-700">{error}</p> : null}
    </article>
  );
}

export default function SettingsPage({ accessToken, user, onUnauthorized }: Props) {
  const [system, setSystem] = useState<SystemState>({ api: null, pricing: null, scraper: null, errors: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.allSettled([
      getApiHealth(),
      getPricingStatus(accessToken),
      getScraperStatus(accessToken),
    ]).then(([apiResult, pricingResult, scraperResult]) => {
      if (cancelled) return;
      const errors: SystemState['errors'] = {};
      const rejected = [pricingResult, scraperResult].find((result) => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.statusCode === 401);
      if (rejected) onUnauthorized();
      if (apiResult.status === 'rejected') errors.api = apiResult.reason instanceof Error ? apiResult.reason.message : 'API health unavailable.';
      if (pricingResult.status === 'rejected') errors.pricing = pricingResult.reason instanceof Error ? pricingResult.reason.message : 'ML status unavailable.';
      if (scraperResult.status === 'rejected') errors.scraper = scraperResult.reason instanceof Error ? scraperResult.reason.message : 'Queue status unavailable.';
      setSystem({
        api: apiResult.status === 'fulfilled' ? apiResult.value : null,
        pricing: pricingResult.status === 'fulfilled' ? pricingResult.value : null,
        scraper: scraperResult.status === 'fulfilled' ? scraperResult.value : null,
        errors,
      });
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [accessToken, onUnauthorized, refreshKey]);

  const apiAvailable = system.api?.status === 'ok';
  const mlAvailable = system.pricing?.ml_service.status === 'ok';
  const queueAvailable = Boolean(system.scraper?.queue.available);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-semibold text-indigo-700">Account and system</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Settings</h2><p className="mt-2 text-sm text-slate-600">View your confirmed account permissions and current service availability.</p></div>
        <button className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-60" type="button" disabled={isLoading} onClick={() => setRefreshKey((value) => value + 1)}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{isLoading ? 'Refreshing' : 'Refresh status'}</button>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-center gap-2"><UserRound className="h-5 w-5 text-indigo-700" /><h3 className="font-bold text-slate-950">Signed-in account</h3></div>
          <dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</dt><dd className="mt-1 font-semibold text-slate-950">{user.name}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</dt><dd className="mt-1 break-all text-slate-700">{user.email}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Role</dt><dd className="mt-1 capitalize font-semibold text-indigo-700">{user.role}</dd></div></dl>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="font-bold text-slate-950">Role permissions</h3><p className="mt-2 text-sm text-slate-600">{permissionText[user.role]}</p>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">{(['viewer', 'manager', 'admin'] as const).map((role) => <div className={`rounded-lg border px-3 py-3 ${role === user.role ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`} key={role}><p className="font-semibold capitalize text-slate-900">{role}</p><p className="mt-1 text-xs leading-5 text-slate-500">{permissionText[role]}</p></div>)}</div>
          <p className="mt-4 text-xs text-slate-500">Profile editing and password controls are unavailable because no corresponding backend contract exists.</p>
        </article>
      </section>

      <section aria-labelledby="system-status-title"><div className="mb-3"><h3 id="system-status-title" className="font-bold text-slate-950">System status</h3><p className="mt-1 text-xs text-slate-500">Each service is checked independently; partial outages do not hide available status.</p></div>
        {isLoading && !system.api && !system.pricing && !system.scraper ? <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Checking services</div> : <div className="grid gap-4 lg:grid-cols-3">
          <StatusCard title="API" icon={CheckCircle2} available={apiAvailable} error={system.errors.api}>{system.api ? <p>Service: <span className="font-semibold text-slate-900">{system.api.service}</span></p> : <p>API health could not be confirmed.</p>}</StatusCard>
          <StatusCard title="ML service" icon={BrainCircuit} available={mlAvailable} error={system.errors.pricing}>{system.pricing ? <><p>Status: <span className="font-semibold text-slate-900">{system.pricing.ml_service.status}</span></p><p className="mt-1">Service: {system.pricing.ml_service.service}</p><p className="mt-1">Version: {system.pricing.ml_service.version}</p></> : <p>ML health could not be confirmed.</p>}</StatusCard>
          <StatusCard title="Scraper queue" icon={ServerCog} available={queueAvailable} error={system.errors.scraper}>{system.scraper ? <div className="space-y-1"><p>Redis/queue: <span className="font-semibold text-slate-900">{system.scraper.queue.available ? 'connected' : 'unavailable'}</span></p><p>Worker: <span className="font-semibold text-slate-900">{system.scraper.worker.status}</span></p><p>Scheduler: <span className="font-semibold text-slate-900">{system.scraper.scheduler.enabled ? system.scraper.scheduler.status : 'disabled'}</span></p></div> : <p>Queue, worker, and scheduler state could not be confirmed.</p>}</StatusCard>
        </div>}
      </section>

      {Object.keys(system.errors).length > 0 ? <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">One or more status checks are unavailable.</span><button className="font-semibold underline" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div> : null}

      {user.role === 'admin' ? <AdminUserManagement accessToken={accessToken} currentUserId={user.id} onUnauthorized={onUnauthorized} /> : null}
    </div>
  );
}
