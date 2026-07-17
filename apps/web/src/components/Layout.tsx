import {
  BarChart3,
  Boxes,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  Search,
  Settings,
  Sparkles,
  TimerReset,
  X,
} from 'lucide-react';
import { ReactNode, useState } from 'react';

import { AuthUser } from '../api/client';

type QueueIndicatorState = 'checking' | 'connected' | 'disconnected';
export type WorkspaceView = 'overview' | 'price-suggestions';

type LayoutProps = {
  children: ReactNode;
  user: AuthUser;
  onLogout: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  queueState: QueueIndicatorState;
  lastRefreshedLabel: string;
  onRefreshQueue: () => void;
  isRefreshingQueue: boolean;
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
};

const navItems = [
  { label: 'Overview', icon: LayoutDashboard, view: 'overview' as const },
  { label: 'Products', icon: Boxes },
  { label: 'Scraper Queue', icon: TimerReset },
  { label: 'Price Suggestions', icon: Sparkles, view: 'price-suggestions' as const },
];

const futureItems = [
  { label: 'Competitor Intelligence', icon: Radar },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Settings', icon: Settings },
];

function QueueIndicator({ state }: { state: QueueIndicatorState }) {
  const label = state === 'connected'
    ? 'Queue online'
    : state === 'disconnected'
      ? 'Queue disconnected'
      : 'Checking queue';
  const classes = state === 'connected'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : state === 'disconnected'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-white text-slate-600';

  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${classes}`}>
      <span
        className={`h-2 w-2 rounded-full ${
          state === 'connected' ? 'bg-emerald-500' : state === 'disconnected' ? 'bg-amber-500' : 'bg-slate-400'
        }`}
      />
      {label}
    </span>
  );
}

function Sidebar({
  collapsed,
  isMobile = false,
  onClose,
  activeView,
  onViewChange,
}: {
  collapsed: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
}) {
  return (
    <aside
      className={`flex h-full flex-col bg-slate-950 text-white shadow-xl shadow-slate-950/10 ${
        isMobile ? 'w-80' : collapsed ? 'w-[88px]' : 'w-72'
      } transition-[width] duration-200`}
    >
      <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-sm font-black shadow-sm shadow-indigo-950/30">
            PP
          </div>
          {!collapsed || isMobile ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">PricePilot AI</p>
              <p className="truncate text-xs text-slate-400">Dynamic Pricing Engine</p>
            </div>
          ) : null}
        </div>
        {isMobile ? (
          <button
            aria-label="Close navigation"
            className="rounded-lg p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            type="button"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.view === activeView;

          return (
            <button
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                isActive
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
              type="button"
              key={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={item.view ? () => {
                onViewChange(item.view);
                onClose?.();
              } : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed || isMobile ? <span className="truncate">{item.label}</span> : null}
            </button>
          );
        })}

        <div className="pt-4">
          {!collapsed || isMobile ? (
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Roadmap
            </p>
          ) : null}
          <div className="space-y-1">
            {futureItems.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-500"
                  type="button"
                  key={item.label}
                  disabled
                  aria-disabled="true"
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {!collapsed || isMobile ? (
                    <>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                        Soon
                      </span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </aside>
  );
}

export default function Layout({
  children,
  user,
  onLogout,
  searchValue,
  onSearchChange,
  queueState,
  lastRefreshedLabel,
  onRefreshQueue,
  isRefreshingQueue,
  activeView,
  onViewChange,
}: LayoutProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex">
        <Sidebar
          collapsed={isSidebarCollapsed}
          activeView={activeView}
          onViewChange={onViewChange}
        />
      </div>

      {isMobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            className="absolute inset-0 h-full w-full bg-slate-950/50"
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className="relative h-full">
            <Sidebar
              collapsed={false}
              isMobile
              onClose={() => setIsMobileNavOpen(false)}
              activeView={activeView}
              onViewChange={onViewChange}
            />
          </div>
        </div>
      ) : null}

      <div className={`min-h-screen transition-[padding] duration-200 ${isSidebarCollapsed ? 'lg:pl-[88px]' : 'lg:pl-72'}`}>
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              aria-label="Open navigation"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 lg:hidden"
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>

            <button
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 lg:inline-flex"
              type="button"
              onClick={() => setIsSidebarCollapsed((value) => !value)}
            >
              {isSidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {activeView === 'overview' ? 'Overview' : 'Review workspace'}
                  </p>
                  <h1 className="truncate text-base font-bold text-slate-950 sm:text-lg">
                    {activeView === 'overview' ? 'Dashboard' : 'Price Suggestions'}
                  </h1>
                </div>
                {activeView === 'overview' ? (
                  <>
                    <span className="hidden h-5 w-px bg-slate-200 sm:block" />
                    <p className="text-xs text-slate-500">
                      Last queue refresh: {lastRefreshedLabel}
                    </p>
                  </>
                ) : null}
              </div>
            </div>

            <div className={`hidden w-full max-w-sm items-center ${activeView === 'overview' ? 'md:flex' : ''}`}>
              <label className="sr-only" htmlFor="product-search">
                Search products
              </label>
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  id="product-search"
                  type="search"
                  placeholder="Search products or SKU"
                  value={searchValue}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
              </div>
            </div>

            <div className={`hidden items-center gap-2 ${activeView === 'overview' ? 'xl:flex' : ''}`}>
              <QueueIndicator state={queueState} />
              <button
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                onClick={onRefreshQueue}
                disabled={isRefreshingQueue}
              >
                {isRefreshingQueue ? 'Refreshing' : 'Refresh'}
              </button>
            </div>

            <div className="hidden min-w-0 text-right sm:block">
              <div className="flex items-center justify-end gap-2">
                <p className="max-w-32 truncate text-sm font-semibold text-slate-900 lg:max-w-44">{user.name}</p>
                <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700">
                  {user.role}
                </span>
              </div>
              <p className="hidden max-w-52 truncate text-xs text-slate-500 md:block">{user.email}</p>
            </div>

            <button
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              type="button"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>

          <div className={`border-t border-slate-100 px-4 py-3 md:hidden ${activeView === 'overview' ? '' : 'hidden'}`}>
            <label className="sr-only" htmlFor="mobile-product-search">
              Search products
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                id="mobile-product-search"
                type="search"
                placeholder="Search products or SKU"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </div>
          </div>
        </header>

        <main className="overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
