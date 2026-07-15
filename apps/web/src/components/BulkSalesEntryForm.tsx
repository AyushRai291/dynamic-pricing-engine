import { FormEvent, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';

import {
  BulkProductSalesRecord,
  BulkProductSalesResponse,
} from '../api/client';
import { getLocalIsoDate, isStrictIsoDate } from '../utils/sales';

type BulkSalesEntryFormProps = {
  onSave: (records: BulkProductSalesRecord[]) => Promise<BulkProductSalesResponse>;
  onSaved: (result: BulkProductSalesResponse) => void;
  onCancel: () => void;
  onSavingChange: (isSaving: boolean) => void;
};

type DraftSalesRow = {
  id: string;
  saleDate: string;
  unitsSold: string;
  sellingPrice: string;
};

type RowErrors = Partial<Record<'saleDate' | 'unitsSold' | 'sellingPrice', string>>;

const MAX_FORM_ROWS = 30;

function createDraftRow(): DraftSalesRow {
  return {
    id: crypto.randomUUID(),
    saleDate: '',
    unitsSold: '',
    sellingPrice: '',
  };
}

function validateRows(rows: DraftSalesRow[], today: string) {
  const errors: Record<string, RowErrors> = {};
  const dateCounts = new Map<string, number>();

  for (const row of rows) {
    if (row.saleDate) {
      dateCounts.set(row.saleDate, (dateCounts.get(row.saleDate) ?? 0) + 1);
    }
  }

  const records = rows.map((row) => {
    const rowErrors: RowErrors = {};
    const unitsSold = Number(row.unitsSold);
    const sellingPrice = Number(row.sellingPrice);

    if (!row.saleDate) {
      rowErrors.saleDate = 'Date is required.';
    } else if (!isStrictIsoDate(row.saleDate)) {
      rowErrors.saleDate = 'Use a valid YYYY-MM-DD date.';
    } else if (row.saleDate > today) {
      rowErrors.saleDate = 'Date cannot be in the future.';
    } else if ((dateCounts.get(row.saleDate) ?? 0) > 1) {
      rowErrors.saleDate = 'Date is duplicated in this entry.';
    }

    if (!/^\d+$/.test(row.unitsSold) || !Number.isSafeInteger(unitsSold)) {
      rowErrors.unitsSold = 'Enter a non-negative whole number.';
    }

    if (!row.sellingPrice.trim() || !Number.isFinite(sellingPrice) || sellingPrice <= 0) {
      rowErrors.sellingPrice = 'Enter a positive price.';
    }

    if (Object.keys(rowErrors).length > 0) {
      errors[row.id] = rowErrors;
    }

    return {
      saleDate: row.saleDate,
      unitsSold,
      sellingPrice,
    };
  });

  return { errors, records };
}

export default function BulkSalesEntryForm({
  onSave,
  onSaved,
  onCancel,
  onSavingChange,
}: BulkSalesEntryFormProps) {
  const [rows, setRows] = useState<DraftSalesRow[]>(() => [createDraftRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, RowErrors>>({});
  const [submitError, setSubmitError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const today = getLocalIsoDate();

  function updateRow(id: string, field: keyof Omit<DraftSalesRow, 'id'>, value: string) {
    setRows((currentRows) => currentRows.map((row) => (
      row.id === id ? { ...row, [field]: value } : row
    )));
    setRowErrors((currentErrors) => {
      if (!currentErrors[id]?.[field]) {
        return currentErrors;
      }

      const nextRowErrors = { ...currentErrors[id] };
      delete nextRowErrors[field];
      return { ...currentErrors, [id]: nextRowErrors };
    });
    setSubmitError('');
  }

  function addRow() {
    if (rows.length >= MAX_FORM_ROWS) {
      return;
    }

    setRows((currentRows) => [...currentRows, createDraftRow()]);
  }

  function removeRow(id: string) {
    if (rows.length <= 1) {
      return;
    }

    setRows((currentRows) => currentRows.filter((row) => row.id !== id));
    setRowErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      delete nextErrors[id];
      return nextErrors;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');

    if (rows.length < 1) {
      setSubmitError('Add at least one daily sales record.');
      return;
    }

    const validation = validateRows(rows, today);
    setRowErrors(validation.errors);

    if (Object.keys(validation.errors).length > 0) {
      setSubmitError('Review the highlighted rows before saving.');
      return;
    }

    setIsSaving(true);
    onSavingChange(true);

    try {
      const result = await onSave(validation.records);
      setRows([createDraftRow()]);
      setRowErrors({});
      onSaved(result);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to save sales records.');
    } finally {
      setIsSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <form
      className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm sm:p-5"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">
            Manual entry
          </p>
          <h3 className="mt-1 text-base font-bold text-slate-950">Bulk daily sales</h3>
          <p className="mt-1 text-sm text-slate-600">
            Add 1–30 rows. An existing product and date will be updated, not duplicated.
          </p>
        </div>
        <span className="inline-flex w-fit rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700">
          {rows.length} / {MAX_FORM_ROWS} rows
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((row, index) => {
          const errors = rowErrors[row.id] ?? {};

          return (
            <div
              className="rounded-xl border border-slate-200 bg-white p-4"
              key={row.id}
              aria-label={`Sales entry row ${index + 1}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                  Record {index + 1}
                </p>
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length === 1 || isSaving}
                  aria-label={`Remove sales entry row ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>

              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor={`sale-date-${row.id}`}>
                    Sale date
                  </label>
                  <input
                    className={`mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm text-slate-950 outline-none transition focus:ring-2 ${
                      errors.saleDate
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                        : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100'
                    }`}
                    id={`sale-date-${row.id}`}
                    type="date"
                    max={today}
                    value={row.saleDate}
                    onChange={(event) => updateRow(row.id, 'saleDate', event.target.value)}
                    disabled={isSaving}
                    aria-invalid={Boolean(errors.saleDate)}
                  />
                  {errors.saleDate ? <p className="mt-1.5 text-xs text-red-700">{errors.saleDate}</p> : null}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor={`units-sold-${row.id}`}>
                    Units sold
                  </label>
                  <input
                    className={`mt-2 h-11 w-full rounded-xl border bg-white px-3 text-sm text-slate-950 outline-none transition focus:ring-2 ${
                      errors.unitsSold
                        ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                        : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100'
                    }`}
                    id={`units-sold-${row.id}`}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    placeholder="0"
                    value={row.unitsSold}
                    onChange={(event) => updateRow(row.id, 'unitsSold', event.target.value)}
                    disabled={isSaving}
                    aria-invalid={Boolean(errors.unitsSold)}
                  />
                  {errors.unitsSold ? <p className="mt-1.5 text-xs text-red-700">{errors.unitsSold}</p> : null}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700" htmlFor={`selling-price-${row.id}`}>
                    Selling price
                  </label>
                  <div className="relative mt-2">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">
                      ₹
                    </span>
                    <input
                      className={`h-11 w-full rounded-xl border bg-white pl-8 pr-3 text-sm text-slate-950 outline-none transition focus:ring-2 ${
                        errors.sellingPrice
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-100'
                          : 'border-slate-200 focus:border-indigo-500 focus:ring-indigo-100'
                      }`}
                      id={`selling-price-${row.id}`}
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={row.sellingPrice}
                      onChange={(event) => updateRow(row.id, 'sellingPrice', event.target.value)}
                      disabled={isSaving}
                      aria-invalid={Boolean(errors.sellingPrice)}
                    />
                  </div>
                  {errors.sellingPrice ? <p className="mt-1.5 text-xs text-red-700">{errors.sellingPrice}</p> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={addRow}
          disabled={rows.length >= MAX_FORM_ROWS || isSaving}
        >
          <Plus className="h-4 w-4" />
          Add row
        </button>

        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={onCancel}
            disabled={isSaving}
          >
            <X className="h-4 w-4" />
            Cancel entry
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? 'Saving records' : 'Save records'}
          </button>
        </div>
      </div>

      {submitError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {submitError}
        </div>
      ) : null}
    </form>
  );
}
