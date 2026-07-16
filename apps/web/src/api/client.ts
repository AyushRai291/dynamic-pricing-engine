const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

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
  min_price?: string;
  max_price?: string;
  inventory_count: number;
  is_active: boolean;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
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

export type QueueStats = {
  name: string;
  available: boolean;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
  isPaused: boolean;
};

export type WorkerStatus = {
  started: boolean;
  queueName: string;
  concurrency: number;
  status: string;
  startedAt: string | null;
  lastError: string | null;
};

export type SchedulerStatus = {
  enabled: boolean;
  expression: string;
  status: string;
  lastRunAt: string | null;
  lastScheduledCount: number;
  lastEnqueuedCount: number;
  lastSkippedCount: number;
  lastError: string | null;
};

export type ScraperStatusResponse = {
  status: string;
  mode: string;
  queue: QueueStats;
  worker: WorkerStatus;
  scheduler: SchedulerStatus;
};

export type ScrapeJobSummary = {
  id: string;
  name: string;
  state: string;
};

export type TriggerScrapeResponse = {
  message: string;
  job: ScrapeJobSummary;
};

export type ScrapeJobResult = {
  competitorDataId?: string;
  productId?: string;
  competitorName?: string;
  competitorUrl?: string;
  price?: number;
  scrapedAt?: string;
};

export type ScrapeJobStatus = {
  id: string;
  name: string;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | string;
  attemptsMade: number;
  attemptsConfigured: number;
  queuedAt: string | null;
  processedAt: string | null;
  finishedAt: string | null;
  result?: ScrapeJobResult;
  failureReason?: string;
};

export type ScrapeJobStatusResponse = {
  job: ScrapeJobStatus;
};

export type CompetitorTargetLatestScrape = {
  price: string;
  isAvailable: boolean;
  scrapedAt: string;
};

export type CompetitorTargetBase = {
  id: string;
  productId: string;
  competitorName: string;
  competitorUrl: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CompetitorTarget = CompetitorTargetBase & {
  latestScrape: CompetitorTargetLatestScrape | null;
};

export type CompetitorTargetsResponse = {
  items: CompetitorTarget[];
};

export type CreateCompetitorTargetInput = {
  competitorName: string;
  competitorUrl: string;
};

export type UpdateCompetitorTargetInput = {
  competitorName?: string;
  competitorUrl?: string;
  isActive?: boolean;
};

export type CompetitorTargetMutationResponse = {
  target: CompetitorTargetBase;
};

export type GetProductsParams = {
  page?: number;
  limit?: number;
  category?: string;
};

export type ProductSalesHistoryRecord = {
  saleDate: string;
  unitsSold: number;
  sellingPrice: string;
  revenue: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductSalesHistoryResponse = {
  productId: string;
  items: ProductSalesHistoryRecord[];
};

export type GetProductSalesHistoryParams = {
  from?: string;
  to?: string;
  limit?: number;
};

export type BulkProductSalesRecord = {
  saleDate: string;
  unitsSold: number;
  sellingPrice: number;
};

export type BulkProductSalesRequest = {
  records: BulkProductSalesRecord[];
};

export type BulkProductSalesResponse = {
  upsertedCount: number;
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

    throw new ApiError(message, response.status);
  }

  return data as T;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
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

export async function getProducts(
  accessToken: string,
  params: GetProductsParams = {}
): Promise<ProductsResponse> {
  const query = new URLSearchParams();

  if (params.page) {
    query.set('page', String(params.page));
  }

  if (params.limit) {
    query.set('limit', String(params.limit));
  }

  if (params.category) {
    query.set('category', params.category);
  }

  const path = query.size > 0 ? `/api/products?${query.toString()}` : '/api/products';
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: authHeaders(accessToken),
  });

  return parseResponse<ProductsResponse>(response);
}

export async function getScraperStatus(accessToken: string): Promise<ScraperStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scraper/status`, {
    headers: authHeaders(accessToken),
  });

  return parseResponse<ScraperStatusResponse>(response);
}

export async function triggerTargetScrape(
  accessToken: string,
  targetId: string
): Promise<TriggerScrapeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scraper/trigger`, {
    method: 'POST',
    headers: {
      ...authHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetId }),
  });

  return parseResponse<TriggerScrapeResponse>(response);
}

export async function getScrapeJobStatus(
  accessToken: string,
  jobId: string,
  signal?: AbortSignal
): Promise<ScrapeJobStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scraper/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(accessToken),
    signal,
  });

  return parseResponse<ScrapeJobStatusResponse>(response);
}

export async function getCompetitorTargets(
  accessToken: string,
  productId: string,
  signal?: AbortSignal
): Promise<CompetitorTargetsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/products/${encodeURIComponent(productId)}/competitor-targets`,
    {
      headers: authHeaders(accessToken),
      signal,
    }
  );

  return parseResponse<CompetitorTargetsResponse>(response);
}

export async function createCompetitorTarget(
  accessToken: string,
  productId: string,
  input: CreateCompetitorTargetInput
): Promise<CompetitorTargetMutationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/products/${encodeURIComponent(productId)}/competitor-targets`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    }
  );

  return parseResponse<CompetitorTargetMutationResponse>(response);
}

export async function updateCompetitorTarget(
  accessToken: string,
  productId: string,
  targetId: string,
  input: UpdateCompetitorTargetInput
): Promise<CompetitorTargetMutationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/products/${encodeURIComponent(productId)}/competitor-targets/${encodeURIComponent(targetId)}`,
    {
      method: 'PATCH',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    }
  );

  return parseResponse<CompetitorTargetMutationResponse>(response);
}

export async function getProductSalesHistory(
  accessToken: string,
  productId: string,
  params: GetProductSalesHistoryParams = {},
  signal?: AbortSignal
): Promise<ProductSalesHistoryResponse> {
  const query = new URLSearchParams();

  if (params.from !== undefined) {
    query.set('from', params.from);
  }

  if (params.to !== undefined) {
    query.set('to', params.to);
  }

  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }

  const queryString = query.toString();
  const path = `/api/products/${encodeURIComponent(productId)}/sales${
    queryString ? `?${queryString}` : ''
  }`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: authHeaders(accessToken),
    signal,
  });

  return parseResponse<ProductSalesHistoryResponse>(response);
}

export async function bulkUpsertProductSales(
  accessToken: string,
  productId: string,
  payload: BulkProductSalesRequest
): Promise<BulkProductSalesResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/products/${encodeURIComponent(productId)}/sales/bulk`,
    {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  return parseResponse<BulkProductSalesResponse>(response);
}
