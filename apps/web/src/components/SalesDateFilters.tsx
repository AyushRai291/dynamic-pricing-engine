import { CalendarDays, Loader2 } from 'lucide-react';

export type SalesDateFilterValues = {
  from: string;
  to: string;
};

type SalesDateFiltersProps = {
  values: SalesDateFilterValues;
  today: string;
  limit: number;
  error: string;
  isLoading: boolean;
  hasAppliedFilters: boolean;
  onChange: (values: SalesDateFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
};

export default function SalesDateFilters({
  values,
  today,
  limit,
  error,
  isLoading,
  hasAppliedFilters,
  onChange,
  onApply,
  onReset,
}: SalesDateFiltersProps) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="sales-filters-title">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Date range</p>
          <h3 id="sales-filters-title" className="mt-1 text-base font-bold text-slate-950">Filter loaded history</h3>
          <p className="mt-1 text-sm text-slate-500">Loads up to {limit} real records from the API.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="sales-filter-from">From</label>
            <input
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 xl:w-40"
              id="sales-filter-from"
              type="date"
              max={today}
              value={values.from}
              onChange={(event) => onChange({ ...values, from: event.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600" htmlFor="sales-filter-to">To</label>
            <input
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 xl:w-40"
              id="sales-filter-to"
              type="date"
              max={today}
              value={values.to}
              onChange={(event) => onChange({ ...values, to: event.target.value })}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
            <button
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300 xl:flex-none"
              type="button"
              onClick={onApply}
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              Apply
            </button>
            <button
              className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 xl:flex-none"
              type="button"
              onClick={onReset}
              disabled={isLoading && !hasAppliedFilters}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
      {error ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
