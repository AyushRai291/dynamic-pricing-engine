import { FormEvent, useEffect, useState } from 'react';
import { Loader2, PackagePlus, X } from 'lucide-react';

import {
  ApiError,
  CreateProductInput,
  Product,
  createProduct,
  updateProduct,
} from '../api/client';

type ProductFormDialogProps = {
  product: Product | null;
  isOpen: boolean;
  accessToken: string;
  canManage: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onSaved: (product: Product) => void | Promise<void>;
};

type FormValues = {
  name: string;
  sku: string;
  category: string;
  currentPrice: string;
  costPrice: string;
  minPrice: string;
  maxPrice: string;
  inventoryCount: string;
  isActive: boolean;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;
type ParsedValues = CreateProductInput & { is_active: boolean };

const MONEY_FIELDS: Array<{
  key: 'currentPrice' | 'costPrice' | 'minPrice' | 'maxPrice';
  label: string;
}> = [
  { key: 'currentPrice', label: 'Current price' },
  { key: 'costPrice', label: 'Cost price' },
  { key: 'minPrice', label: 'Minimum price' },
  { key: 'maxPrice', label: 'Maximum price' },
];

function initialValues(product: Product | null): FormValues {
  return {
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    category: product?.category ?? '',
    currentPrice: product?.current_price ?? '',
    costPrice: product?.cost_price ?? '',
    minPrice: product?.min_price ?? '',
    maxPrice: product?.max_price ?? '',
    inventoryCount: String(product?.inventory_count ?? 0),
    isActive: product?.is_active ?? true,
  };
}

function validate(values: FormValues, isEditing: boolean) {
  const errors: FormErrors = {};
  const parsedMoney = {} as Record<(typeof MONEY_FIELDS)[number]['key'], number>;
  const name = values.name.trim();
  const sku = values.sku.trim();

  if (!name) errors.name = 'Name is required.';
  if (!isEditing && !sku) errors.sku = 'SKU is required.';

  for (const field of MONEY_FIELDS) {
    const rawValue = values[field.key].trim();
    const numberValue = Number(rawValue);

    if (!rawValue || !Number.isFinite(numberValue)) {
      errors[field.key] = `${field.label} must be a number.`;
    } else if (numberValue < 0) {
      errors[field.key] = `${field.label} must be at least 0.`;
    } else {
      parsedMoney[field.key] = numberValue;
    }
  }

  const inventoryCount = Number(values.inventoryCount);
  if (!values.inventoryCount.trim() || !Number.isInteger(inventoryCount) || inventoryCount < 0) {
    errors.inventoryCount = 'Inventory must be a non-negative integer.';
  }

  if (Object.keys(errors).length === 0) {
    if (parsedMoney.minPrice > parsedMoney.maxPrice) {
      errors.minPrice = 'Minimum price cannot exceed maximum price.';
    }
    if (parsedMoney.costPrice > parsedMoney.currentPrice) {
      errors.costPrice = 'Cost price cannot exceed current price.';
    }
    if (parsedMoney.minPrice > parsedMoney.currentPrice) {
      errors.minPrice = 'Minimum price cannot exceed current price.';
    }
    if (parsedMoney.currentPrice > parsedMoney.maxPrice) {
      errors.currentPrice = 'Current price cannot exceed maximum price.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors, parsed: null };
  }

  const parsed: ParsedValues = {
    name,
    sku,
    category: values.category.trim() || null,
    current_price: parsedMoney.currentPrice,
    cost_price: parsedMoney.costPrice,
    min_price: parsedMoney.minPrice,
    max_price: parsedMoney.maxPrice,
    inventory_count: inventoryCount,
    is_active: values.isActive,
  };

  return { errors, parsed };
}

export default function ProductFormDialog({
  product,
  isOpen,
  accessToken,
  canManage,
  onClose,
  onUnauthorized,
  onSaved,
}: ProductFormDialogProps) {
  const [values, setValues] = useState<FormValues>(() => initialValues(product));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = Boolean(product);

  useEffect(() => {
    if (isOpen) {
      setValues(initialValues(product));
      setErrors({});
      setSubmitError('');
    }
  }, [isOpen, product]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen || !canManage) return null;

  function updateValue<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(values, isEditing);
    setErrors(result.errors);
    setSubmitError('');

    if (!result.parsed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = product
        ? await updateProduct(accessToken, product.id, {
          name: result.parsed.name,
          category: result.parsed.category,
          current_price: result.parsed.current_price,
          cost_price: result.parsed.cost_price,
          min_price: result.parsed.min_price,
          max_price: result.parsed.max_price,
          inventory_count: result.parsed.inventory_count,
          is_active: result.parsed.is_active,
        })
        : await createProduct(accessToken, {
          name: result.parsed.name,
          sku: result.parsed.sku,
          category: result.parsed.category,
          current_price: result.parsed.current_price,
          cost_price: result.parsed.cost_price,
          min_price: result.parsed.min_price,
          max_price: result.parsed.max_price,
          inventory_count: result.parsed.inventory_count,
        });

      await onSaved(response.product);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        onUnauthorized();
        return;
      }
      setSubmitError(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
      <button className="absolute inset-0 h-full w-full bg-slate-950/60" type="button" aria-label="Close product form overlay" onClick={isSubmitting ? undefined : onClose} />
      <div className="relative max-h-[100dvh] w-full overflow-y-auto bg-white shadow-2xl sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-slate-200">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Product record</p>
            <h2 id="product-form-title" className="mt-1 text-xl font-bold text-slate-950">{isEditing ? 'Edit product' : 'Create product'}</h2>
            <p className="mt-1 text-sm text-slate-500">Values are validated against the API contract and saved without derived pricing calculations.</p>
          </div>
          <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" type="button" onClick={onClose} disabled={isSubmitting} aria-label="Close product form"><X className="h-5 w-5" /></button>
        </header>

        <form className="space-y-5 p-5 sm:p-6" onSubmit={handleSubmit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Name
              <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" value={values.name} onChange={(event) => updateValue('name', event.target.value)} disabled={isSubmitting} />
              {errors.name ? <span className="mt-1 block text-xs text-red-700">{errors.name}</span> : null}
            </label>
            <label className="text-sm font-semibold text-slate-700">
              SKU
              <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100" value={values.sku} onChange={(event) => updateValue('sku', event.target.value)} disabled={isSubmitting || isEditing} />
              {isEditing ? <span className="mt-1 block text-xs text-slate-500">SKU cannot be changed by the API.</span> : null}
              {errors.sku ? <span className="mt-1 block text-xs text-red-700">{errors.sku}</span> : null}
            </label>
          </div>

          <label className="block text-sm font-semibold text-slate-700">
            Category <span className="font-normal text-slate-400">(optional)</span>
            <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" value={values.category} onChange={(event) => updateValue('category', event.target.value)} disabled={isSubmitting} />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            {MONEY_FIELDS.map((field) => (
              <label className="text-sm font-semibold text-slate-700" key={field.key}>
                {field.label}
                <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" type="number" min="0" step="0.01" inputMode="decimal" value={values[field.key]} onChange={(event) => updateValue(field.key, event.target.value)} disabled={isSubmitting} />
                {errors[field.key] ? <span className="mt-1 block text-xs text-red-700">{errors[field.key]}</span> : null}
              </label>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <label className="text-sm font-semibold text-slate-700">
              Inventory count
              <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 font-normal outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" type="number" min="0" step="1" inputMode="numeric" value={values.inventoryCount} onChange={(event) => updateValue('inventoryCount', event.target.value)} disabled={isSubmitting} />
              {errors.inventoryCount ? <span className="mt-1 block text-xs text-red-700">{errors.inventoryCount}</span> : null}
            </label>
            {isEditing ? (
              <label className="flex h-11 items-center gap-3 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={values.isActive} onChange={(event) => updateValue('isActive', event.target.checked)} disabled={isSubmitting} />
                Active product
              </label>
            ) : null}
          </div>

          {submitError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{submitError}</div> : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
            <button className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700" type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:bg-indigo-300" type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
              {isSubmitting ? 'Saving' : isEditing ? 'Save changes' : 'Create product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
