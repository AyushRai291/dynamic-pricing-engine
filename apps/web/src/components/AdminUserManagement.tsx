import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  AdminUsersResponse,
  ApiError,
  UserRole,
  getAdminUsers,
  updateAdminUserRole,
} from '../api/client';

type Props = {
  accessToken: string;
  currentUserId: string;
  onUnauthorized: () => void;
};

const roles: UserRole[] = ['viewer', 'manager', 'admin'];
const USERS_PER_PAGE = 20;

export default function AdminUserManagement({ accessToken, currentUserId, onUnauthorized }: Props) {
  const [roleFilter, setRoleFilter] = useState<'' | UserRole>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminUsersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError('');
    getAdminUsers(accessToken, {
      page,
      limit: USERS_PER_PAGE,
      role: roleFilter || undefined,
    }, controller.signal)
      .then(setResult)
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        if (loadError instanceof ApiError && loadError.statusCode === 401) {
          onUnauthorized();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Unable to load users.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [accessToken, onUnauthorized, page, refreshKey, roleFilter]);

  async function changeRole(userId: string, userName: string, currentRole: UserRole, role: UserRole) {
    if (role === currentRole) return;
    const confirmed = window.confirm(
      `Change ${userName}'s role from ${currentRole} to ${role}? This changes their API permissions.`
    );
    if (!confirmed) return;

    setUpdatingId(userId);
    setError('');
    setSuccess('');
    try {
      await updateAdminUserRole(accessToken, userId, role);
      setSuccess(`${userName}'s role was updated to ${role}.`);
      setRefreshKey((value) => value + 1);
    } catch (updateError) {
      if (updateError instanceof ApiError && updateError.statusCode === 401) {
        onUnauthorized();
      } else {
        setError(updateError instanceof Error ? updateError.message : 'Unable to update role.');
      }
    } finally {
      setUpdatingId(null);
    }
  }

  const pagination = result?.pagination;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-labelledby="user-management-title">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-indigo-700" /><h3 id="user-management-title" className="font-bold text-slate-950">User role management</h3></div>
          <p className="mt-1 text-xs text-slate-500">Admin-only. Your own role cannot be changed here.</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Filter users by role" value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value as '' | UserRole); setPage(1); }}>
            <option value="">All roles</option>
            {roles.map((role) => <option value={role} key={role}>{role}</option>)}
          </select>
          <button className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>
      </div>

      {error ? <div className="m-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{error}</span><button className="font-semibold underline" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div> : null}
      {success ? <div className="m-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{success}</div> : null}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading users</div>
      ) : !result || result.items.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-500">No users match this role filter.</div>
      ) : (
        <div className="divide-y divide-slate-200">
          {result.items.map((account) => {
            const isCurrentAdmin = account.id === currentUserId;
            const disabled = isCurrentAdmin || !account.isActive || updatingId === account.id;
            return (
              <article className="grid gap-3 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center" key={account.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold text-slate-950">{account.name}</p>{isCurrentAdmin ? <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">You</span> : null}{!account.isActive ? <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">Inactive</span> : null}</div>
                  <p className="mt-1 truncate text-sm text-slate-600">{account.email}</p>
                  <p className="mt-1 text-xs text-slate-500">Created {new Date(account.createdAt).toLocaleString()}</p>
                  {isCurrentAdmin ? <p className="mt-1 text-xs text-amber-700">Self-role changes are disabled to prevent accidental admin lockout.</p> : null}
                </div>
                <label className="text-xs font-semibold text-slate-600">Role
                  <span className="relative mt-1 block">
                    <select className="h-10 min-w-36 rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm capitalize disabled:bg-slate-100 disabled:text-slate-500" value={account.role} disabled={disabled} onChange={(event) => void changeRole(account.id, account.name, account.role, event.target.value as UserRole)}>
                      {roles.map((role) => <option value={role} key={role}>{role}</option>)}
                    </select>
                    {updatingId === account.id ? <Loader2 className="absolute right-2 top-3 h-4 w-4 animate-spin text-slate-500" /> : null}
                  </span>
                </label>
              </article>
            );
          })}
        </div>
      )}

      {pagination && pagination.totalPages > 1 ? <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm sm:px-5"><span className="text-slate-500">Page {pagination.page} of {pagination.totalPages} · {pagination.total} users</span><div className="flex gap-2"><button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold disabled:opacity-50" type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></div> : null}
    </section>
  );
}
