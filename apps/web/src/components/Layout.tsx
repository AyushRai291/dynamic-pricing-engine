import { ReactNode } from 'react';

type LayoutProps = {
  children: ReactNode;
  onLogout: () => void;
};

export default function Layout({ children, onLogout }: LayoutProps) {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">DPE</p>
            <p className="text-base font-semibold text-slate-950">Dynamic Pricing Engine</p>
          </div>
          <button
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            type="button"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
