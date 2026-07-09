const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export type LoginResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    is_active: boolean;
  };
  accessToken: string;
  refreshToken: string;
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  current_price: string;
  cost_price: string;
  inventory_count: number;
  is_active: boolean;
};

export type ProductsResponse = {
  items: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    const errorMessage = typeof data === 'object'
      && data !== null
      && 'error' in data
      && typeof data.error === 'object'
      && data.error !== null
      && 'message' in data.error
      && typeof data.error.message === 'string'
      ? data.error.message
      : null;
    const message = errorMessage || 'Request failed';

    throw new Error(message);
  }

  return data as T;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  return parseResponse<LoginResponse>(response);
}

export async function getProducts(accessToken: string): Promise<ProductsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/products`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return parseResponse<ProductsResponse>(response);
}
