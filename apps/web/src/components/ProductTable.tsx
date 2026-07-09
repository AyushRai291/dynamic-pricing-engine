import { Product } from '../api/client';

type ProductTableProps = {
  products: Product[];
};

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function formatMoney(value: string) {
  return currencyFormatter.format(Number(value));
}

export default function ProductTable({ products }: ProductTableProps) {
  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
        No products found.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Name</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">SKU</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Category</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">Current Price</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">Cost Price</th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">Inventory</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {products.map((product) => (
              <tr className="hover:bg-slate-50" key={product.id}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                  {product.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{product.sku}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {product.category || 'Uncategorized'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {formatMoney(product.current_price)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {formatMoney(product.cost_price)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-slate-700">
                  {product.inventory_count}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={
                      product.is_active
                        ? 'rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700'
                        : 'rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600'
                    }
                  >
                    {product.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
