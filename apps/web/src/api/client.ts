const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const ACCESS_TOKEN_STORAGE_KEY = 'dpe_access_token';
const REFRESH_TOKEN_STORAGE_KEY = 'dpe_refresh_token';

export type UserRole = 'viewer' | 'manager' | 'admin';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AuthSession = {
  accessToken: string | null;
  refreshToken: string | null;
};

let authSession: AuthSession = {
  accessToken: localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY),
  refreshToken: localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY),
};
const authSessionListeners = new Set<() => void>();
let refreshPromise: Promise<string | null> | null = null;

function publishAuthSession(nextSession: AuthSession) {
  authSession = nextSession;
  authSessionListeners.forEach((listener) => listener());
}

export function getAuthSession() {
  return authSession;
}

export function subscribeAuthSession(listener: () => void) {
  authSessionListeners.add(listener);
  return () => authSessionListeners.delete(listener);
}

export function saveAuthSession(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  publishAuthSession({ accessToken, refreshToken });
}

export function clearAuthSession() {
  localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  publishAuthSession({ accessToken: null, refreshToken: null });
}

function clearRefreshSession(refreshToken: string) {
  if (authSession.refreshToken === refreshToken) {
    clearAuthSession();
  }
}

function saveRefreshedAccessToken(accessToken: string) {
  localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  publishAuthSession({ ...authSession, accessToken });
}

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

export type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export type LoginResponse = AuthResponse;

export type MeResponse = {
  user: AuthUser;
};

type RefreshResponse = {
  accessToken: string;
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

export type CreateProductInput = {
  name: string;
  sku: string;
  category: string | null;
  current_price: number;
  cost_price: number;
  min_price: number;
  max_price: number;
  inventory_count: number;
};

export type UpdateProductInput = Omit<CreateProductInput, 'sku'> & {
  is_active: boolean;
};

export type ProductResponse = {
  product: Product;
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

export type ApiHealthResponse = {
  status: string;
  service: string;
};

export type PricingStatusResponse = {
  status: string;
  ml_service: {
    status: string;
    service: string;
    version: string;
  };
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
};

export type AdminUsersResponse = {
  items: AdminUser[];
  pagination: ProductsResponse['pagination'];
};

export type AdminUserResponse = {
  user: AdminUser;
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

export type ScrapeJobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';

export type RecentScrapeJob = {
  jobId: string;
  state: ScrapeJobState;
  targetId: string | null;
  productId: string | null;
  productName: string | null;
  competitorName: string | null;
  attemptsMade: number;
  maxAttempts: number;
  queuedAt: string | null;
  processedOn: string | null;
  finishedOn: string | null;
  progress: number | null;
  failureReason: string | null;
};

export type ScrapeJobsResponse = {
  items: RecentScrapeJob[];
  pagination: ProductsResponse['pagination'];
};

export type RetryScrapeJobResponse = {
  message: string;
  job: RecentScrapeJob;
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

export type GlobalCompetitorTarget = {
  targetId: string;
  productId: string;
  productName: string;
  productSku: string;
  competitorName: string;
  competitorUrl: string;
  isActive: boolean;
  latestScrape: CompetitorTargetLatestScrape | null;
};

export type GlobalCompetitorTargetsResponse = {
  items: GlobalCompetitorTarget[];
  pagination: ProductsResponse['pagination'];
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

export type PriceSuggestionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type PriceSuggestionRationale = {
  schemaVersion: string;
  provider: string;
  model: string;
  summary: string;
  keyFactors: string[];
  risks: string[];
  guardrailExplanation: string;
  limitation: string;
  promptTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
  generatedAt: string;
};

export type PriceSuggestion = {
  id: string;
  status: PriceSuggestionStatus;
  product: {
    id: string;
    name: string;
    sku: string;
  };
  current_price: number;
  suggested_price: number;
  percentage_change: number;
  price_score: number | null;
  action: 'increase' | 'decrease' | 'hold' | null;
  model_version: string | null;
  model_source: string | null;
  competitor_snapshot: {
    count: number;
    available_count: number;
    average_price: number | null;
  };
  raw_candidate: number;
  applied_guardrails: string[];
  created_at: string;
  limitation: string;
  aiRationale: PriceSuggestionRationale | null;
  approved_by?: string | null;
  approved_at?: string | null;
  expires_at?: string | null;
};

export type PriceSuggestionsResponse = {
  items: PriceSuggestion[];
  limit: number;
};

export type PriceSuggestionResponse = {
  suggestion: PriceSuggestion;
};

export type PriceSuggestionRationaleResponse = {
  generated: boolean;
  suggestionId: string;
  rationale: PriceSuggestionRationale;
};

export type PriceHistoryAudit = {
  id: string;
  product_id: string;
  old_price: number;
  new_price: number;
  change_reason: string;
  suggestion_id: string;
  changed_by: string;
  created_at: string;
};

export type ApprovePriceSuggestionResponse = {
  suggestion: PriceSuggestion;
  old_price: number;
  new_price: number;
  price_history: PriceHistoryAudit;
};

export type AnalyticsOverviewResponse = {
  range: { from: string; to: string };
  metrics: {
    activeProductCount: number;
    recordedUnitsSold: number;
    recordedRevenue: string;
    recordedSalesDays: number;
    approvedPriceChangeCount: number;
  };
  suggestionCounts: Record<'pending' | 'approved' | 'rejected' | 'expired', number>;
  dailySeries: Array<{
    date: string;
    unitsSold: number;
    revenue: string;
  }>;
};

export type GlobalPriceHistoryItem = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  oldPrice: string;
  newPrice: string;
  percentageChange: string | null;
  source: 'price_suggestion' | 'price_history';
  changeReason: string;
  suggestionId: string | null;
  changedAt: string;
};

export type GlobalPriceHistoryResponse = {
  items: GlobalPriceHistoryItem[];
  pagination: ProductsResponse['pagination'];
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

function withAuthorization(init: RequestInit, accessToken: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  return { ...init, headers };
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const refreshToken = authSession.refreshToken;

  if (!refreshToken) {
    clearAuthSession();
    return null;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        clearRefreshSession(refreshToken);
        return null;
      }

      const data = await response.json().catch(() => null) as RefreshResponse | null;

      if (!data || typeof data.accessToken !== 'string' || !data.accessToken) {
        clearRefreshSession(refreshToken);
        return null;
      }

      if (authSession.refreshToken !== refreshToken) {
        return null;
      }

      saveRefreshedAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      clearRefreshSession(refreshToken);
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function authenticatedFetch(
  path: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const currentAccessToken = authSession.accessToken || accessToken;
  const response = await fetch(
    `${API_BASE_URL}${path}`,
    withAuthorization(init, currentAccessToken)
  );

  if (response.status !== 401) {
    return response;
  }

  const refreshedAccessToken = await refreshAccessToken();

  if (!refreshedAccessToken) {
    return response;
  }

  const retryResponse = await fetch(
    `${API_BASE_URL}${path}`,
    withAuthorization(init, refreshedAccessToken)
  );

  if (retryResponse.status === 401 && authSession.accessToken === refreshedAccessToken) {
    clearAuthSession();
  }

  return retryResponse;
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

export async function register(
  name: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });

  return parseResponse<AuthResponse>(response);
}

export async function getCurrentUser(accessToken: string): Promise<MeResponse> {
  const response = await authenticatedFetch('/api/auth/me', accessToken);
  return parseResponse<MeResponse>(response);
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
  const response = await authenticatedFetch(path, accessToken);

  return parseResponse<ProductsResponse>(response);
}

export async function createProduct(
  accessToken: string,
  input: CreateProductInput
): Promise<ProductResponse> {
  const response = await authenticatedFetch('/api/products', accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return parseResponse<ProductResponse>(response);
}

export async function updateProduct(
  accessToken: string,
  productId: string,
  input: UpdateProductInput
): Promise<ProductResponse> {
  const response = await authenticatedFetch(
    `/api/products/${encodeURIComponent(productId)}`,
    accessToken,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  return parseResponse<ProductResponse>(response);
}

export async function getProduct(
  accessToken: string,
  productId: string
): Promise<ProductResponse> {
  const response = await authenticatedFetch(
    `/api/products/${encodeURIComponent(productId)}`,
    accessToken
  );

  return parseResponse<ProductResponse>(response);
}

export async function getAnalyticsOverview(
  accessToken: string,
  range: { from: string; to: string },
  signal?: AbortSignal
): Promise<AnalyticsOverviewResponse> {
  const query = new URLSearchParams(range);
  const response = await authenticatedFetch(
    `/api/analytics/overview?${query.toString()}`,
    accessToken,
    { signal }
  );

  return parseResponse<AnalyticsOverviewResponse>(response);
}

export async function getGlobalPriceHistory(
  accessToken: string,
  params: { productId?: string; from?: string; to?: string; page?: number; limit?: number } = {},
  signal?: AbortSignal
): Promise<GlobalPriceHistoryResponse> {
  const query = new URLSearchParams();
  if (params.productId) query.set('productId', params.productId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const queryString = query.toString();
  const response = await authenticatedFetch(
    `/api/pricing/history${queryString ? `?${queryString}` : ''}`,
    accessToken,
    { signal }
  );

  return parseResponse<GlobalPriceHistoryResponse>(response);
}

export async function getScraperStatus(accessToken: string): Promise<ScraperStatusResponse> {
  const response = await authenticatedFetch('/api/scraper/status', accessToken);

  return parseResponse<ScraperStatusResponse>(response);
}

export async function getApiHealth(): Promise<ApiHealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`);
  return parseResponse<ApiHealthResponse>(response);
}

export async function getPricingStatus(accessToken: string): Promise<PricingStatusResponse> {
  const response = await authenticatedFetch('/api/pricing/status', accessToken);
  return parseResponse<PricingStatusResponse>(response);
}

export async function getAdminUsers(
  accessToken: string,
  params: { page?: number; limit?: number; role?: UserRole } = {},
  signal?: AbortSignal
): Promise<AdminUsersResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  if (params.role) query.set('role', params.role);
  const queryString = query.toString();
  const response = await authenticatedFetch(
    `/api/admin/users${queryString ? `?${queryString}` : ''}`,
    accessToken,
    { signal }
  );
  return parseResponse<AdminUsersResponse>(response);
}

export async function updateAdminUserRole(
  accessToken: string,
  userId: string,
  role: UserRole
): Promise<AdminUserResponse> {
  const response = await authenticatedFetch(
    `/api/admin/users/${encodeURIComponent(userId)}/role`,
    accessToken,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }
  );
  return parseResponse<AdminUserResponse>(response);
}

export async function triggerTargetScrape(
  accessToken: string,
  targetId: string
): Promise<TriggerScrapeResponse> {
  const response = await authenticatedFetch('/api/scraper/trigger', accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId }),
  });

  return parseResponse<TriggerScrapeResponse>(response);
}

export async function getScrapeJobStatus(
  accessToken: string,
  jobId: string,
  signal?: AbortSignal
): Promise<ScrapeJobStatusResponse> {
  const response = await authenticatedFetch(
    `/api/scraper/jobs/${encodeURIComponent(jobId)}`,
    accessToken,
    {
      signal,
    }
  );

  return parseResponse<ScrapeJobStatusResponse>(response);
}

export async function getScrapeJobs(
  accessToken: string,
  params: { state?: ScrapeJobState; page?: number; limit?: number } = {},
  signal?: AbortSignal
): Promise<ScrapeJobsResponse> {
  const query = new URLSearchParams();
  if (params.state) query.set('state', params.state);
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const queryString = query.toString();
  const response = await authenticatedFetch(
    `/api/scraper/jobs${queryString ? `?${queryString}` : ''}`,
    accessToken,
    { signal }
  );

  return parseResponse<ScrapeJobsResponse>(response);
}

export async function retryScrapeJob(
  accessToken: string,
  jobId: string
): Promise<RetryScrapeJobResponse> {
  const response = await authenticatedFetch(
    `/api/scraper/jobs/${encodeURIComponent(jobId)}/retry`,
    accessToken,
    { method: 'POST' }
  );

  return parseResponse<RetryScrapeJobResponse>(response);
}

export async function getGlobalCompetitorTargets(
  accessToken: string,
  params: { active?: boolean; page?: number; limit?: number } = {},
  signal?: AbortSignal
): Promise<GlobalCompetitorTargetsResponse> {
  const query = new URLSearchParams();
  if (params.active !== undefined) query.set('active', String(params.active));
  if (params.page) query.set('page', String(params.page));
  if (params.limit) query.set('limit', String(params.limit));
  const queryString = query.toString();
  const response = await authenticatedFetch(
    `/api/competitor-targets${queryString ? `?${queryString}` : ''}`,
    accessToken,
    { signal }
  );

  return parseResponse<GlobalCompetitorTargetsResponse>(response);
}

export async function getCompetitorTargets(
  accessToken: string,
  productId: string,
  signal?: AbortSignal
): Promise<CompetitorTargetsResponse> {
  const response = await authenticatedFetch(
    `/api/products/${encodeURIComponent(productId)}/competitor-targets`,
    accessToken,
    {
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
  const response = await authenticatedFetch(
    `/api/products/${encodeURIComponent(productId)}/competitor-targets`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  const response = await authenticatedFetch(
    `/api/products/${encodeURIComponent(productId)}/competitor-targets/${encodeURIComponent(targetId)}`,
    accessToken,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
  const response = await authenticatedFetch(path, accessToken, { signal });

  return parseResponse<ProductSalesHistoryResponse>(response);
}

export async function bulkUpsertProductSales(
  accessToken: string,
  productId: string,
  payload: BulkProductSalesRequest
): Promise<BulkProductSalesResponse> {
  const response = await authenticatedFetch(
    `/api/products/${encodeURIComponent(productId)}/sales/bulk`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  return parseResponse<BulkProductSalesResponse>(response);
}

export async function createPriceSuggestion(
  accessToken: string,
  productId: string
): Promise<PriceSuggestionResponse> {
  const response = await authenticatedFetch(
    `/api/pricing/products/${encodeURIComponent(productId)}/suggestions`,
    accessToken,
    {
      method: 'POST',
    }
  );

  return parseResponse<PriceSuggestionResponse>(response);
}

export async function getPriceSuggestions(
  accessToken: string,
  status: Exclude<PriceSuggestionStatus, 'expired'>,
  limit = 20,
  signal?: AbortSignal
): Promise<PriceSuggestionsResponse> {
  const query = new URLSearchParams({ status, limit: String(limit) });
  const response = await authenticatedFetch(
    `/api/pricing/suggestions?${query.toString()}`,
    accessToken,
    { signal }
  );

  return parseResponse<PriceSuggestionsResponse>(response);
}

export async function getPriceSuggestion(
  accessToken: string,
  suggestionId: string,
  signal?: AbortSignal
): Promise<PriceSuggestionResponse> {
  const response = await authenticatedFetch(
    `/api/pricing/suggestions/${encodeURIComponent(suggestionId)}`,
    accessToken,
    {
      signal,
    }
  );

  return parseResponse<PriceSuggestionResponse>(response);
}

export async function generatePriceSuggestionRationale(
  accessToken: string,
  suggestionId: string
): Promise<PriceSuggestionRationaleResponse> {
  const response = await authenticatedFetch(
    `/api/pricing/suggestions/${encodeURIComponent(suggestionId)}/rationale`,
    accessToken,
    {
      method: 'POST',
    }
  );

  return parseResponse<PriceSuggestionRationaleResponse>(response);
}

export async function approvePriceSuggestion(
  accessToken: string,
  suggestionId: string
): Promise<ApprovePriceSuggestionResponse> {
  const response = await authenticatedFetch(
    `/api/pricing/suggestions/${encodeURIComponent(suggestionId)}/approve`,
    accessToken,
    {
      method: 'POST',
    }
  );

  return parseResponse<ApprovePriceSuggestionResponse>(response);
}

export async function rejectPriceSuggestion(
  accessToken: string,
  suggestionId: string
): Promise<PriceSuggestionResponse> {
  const response = await authenticatedFetch(
    `/api/pricing/suggestions/${encodeURIComponent(suggestionId)}/reject`,
    accessToken,
    {
      method: 'POST',
    }
  );

  return parseResponse<PriceSuggestionResponse>(response);
}
