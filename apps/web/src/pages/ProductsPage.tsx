import { useState } from 'react';
import { CheckCircle2, PackagePlus } from 'lucide-react';

import { Product } from '../api/client';
import ProductFormDialog from '../components/ProductFormDialog';
import ProductTable, { ProductTableProps } from '../components/ProductTable';

type ProductsPageProps = Omit<ProductTableProps, 'onEditProduct'> & {
  onProductsChanged: () => void | Promise<void>;
};

export default function ProductsPage({
  onProductsChanged,
  ...tableProps
}: ProductsPageProps) {
  const [formProduct, setFormProduct] = useState<Product | null | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const { accessToken, canManage, onUnauthorized, pagination } = tableProps;

  async function handleSaved(product: Product) {
    const action = formProduct ? 'updated' : 'created';
    setNotice(`${product.name} was ${action}.`);
    setFormProduct(undefined);
    await onProductsChanged();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold text-indigo-700">Product workspace</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Products</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Browse real product records. Category filtering is server-side; search filters only the currently loaded API page.
          </p>
          {pagination ? <p className="mt-1 text-xs text-slate-500">{pagination.total} products in the current category scope.</p> : null}
        </div>
        {canManage ? (
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            type="button"
            onClick={() => {
              setNotice('');
              setFormProduct(null);
            }}
          >
            <PackagePlus className="h-4 w-4" />
            Create product
          </button>
        ) : null}
      </section>

      {!canManage ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950" role="status">
          Viewer access is read-only. Product records and related history remain available to inspect.
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {notice}
        </div>
      ) : null}

      <ProductTable
        {...tableProps}
        onEditProduct={canManage ? (product) => {
          setNotice('');
          setFormProduct(product);
        } : undefined}
      />

      <ProductFormDialog
        product={formProduct ?? null}
        isOpen={formProduct !== undefined}
        accessToken={accessToken}
        canManage={canManage}
        onClose={() => setFormProduct(undefined)}
        onUnauthorized={onUnauthorized}
        onSaved={handleSaved}
      />
    </div>
  );
}
