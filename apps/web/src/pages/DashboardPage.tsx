import { useEffect, useState } from 'react';

import { getProducts, Product, ProductsResponse } from '../api/client';
import Layout from '../components/Layout';
import ProductTable from '../components/ProductTable';

type DashboardPageProps = {
  accessToken: string;
  onLogout: () => void;
};

export default function DashboardPage({ accessToken, onLogout }: DashboardPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<ProductsResponse['pagination'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadProducts() {
      setIsLoading(true);
      setError('');

      try {
        const result = await getProducts(accessToken);

        if (isMounted) {
          setProducts(result.items);
          setPagination(result.pagination);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load products');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadProducts();

    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  return (
    <Layout onLogout={onLogout}>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Products</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Pricing Dashboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Monitor product prices, costs, inventory, and active status from the API.
          </p>
        </div>
        {pagination ? (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {pagination.total} products
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          Loading products...
        </div>
      ) : null}

      {!isLoading && error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!isLoading && !error ? <ProductTable products={products} /> : null}
    </Layout>
  );
}
