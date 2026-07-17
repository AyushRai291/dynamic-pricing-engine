# Dynamic Pricing Engine

An interview-scale, full-stack pricing operations workspace. It combines product and sales records, configured competitor collection, a human-reviewed price-suggestion workflow, recorded-data analytics, role-based access, and two deliberately distinct ML capabilities.

This repository is a portable single-instance baseline, not evidence of a cloud deployment or real-world pricing uplift. Price changes happen only after an authorized human approves a pending suggestion.

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|same-origin HTTP| N[Nginx / React Web]
  N -->|/api and /health| A[Express API]
  A --> P[(PostgreSQL 16)]
  A --> R[(Redis 7 / BullMQ)]
  R --> W[Scraper worker / Chromium]
  A --> M[FastAPI ML service]
  A -. optional rationale .-> G[Google Gemini]
  W -->|validated public HTTP(S) targets| C[Configured competitor pages]
```

Typical suggestion flow:

1. A manager or admin selects an active product.
2. The API loads current product facts and the latest exact-match configured competitor records.
3. The ML service returns the synthetic bootstrap 0–100 price score.
4. The API calculates a deterministic guardrail-bounded candidate and stores a pending suggestion with an expiry.
5. An authorized human approves or rejects it. Approval updates the product and inserts one price-history row atomically; rejection and expiry do neither.

## Tech stack

- Web: React 19, TypeScript, Vite, Tailwind CSS, Recharts
- API: Node.js 22, Express 5, PostgreSQL client, JWT, bcrypt
- Queue/scraper: Redis 7, BullMQ, Puppeteer/Chromium, Cheerio
- ML: Python 3.10, FastAPI, pandas, scikit-learn, XGBoost
- Production baseline: multi-stage Docker builds, Docker Compose, unprivileged Nginx
- CI: GitHub Actions jobs for API, Web, and clean-clone-safe ML tests

## Local development

Prerequisites: Node.js 22, pnpm 11.10.0, Python 3.10, Docker with Compose, and enough memory to load the tracked models.

```sh
pnpm install --frozen-lockfile
docker compose up -d
```

Copy `apps/api/.env.example` to the ignored `apps/api/.env`, replace the JWT placeholders, and keep the example local PostgreSQL/Redis URLs unless your services differ. Never commit the resulting file.

Apply migrations to a fresh database:

```sh
DATABASE_URL=postgresql://dpe_user:dpe_password@localhost:5432/dynamic_pricing \
  pnpm --filter @dpe/api exec node src/scripts/migrate.js
```

The migration runner orders SQL files, records them in `schema_migrations`, and refuses to guess a baseline for a non-empty legacy database. Optional sample products are in `database/seeds/001_seed_products.sql` and are not applied automatically.

Create and run the Python environment:

```sh
cd apps/ml-service
python -m venv .venv
# Activate .venv using your shell's normal command.
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

In separate terminals:

```sh
pnpm --filter @dpe/api dev
pnpm --filter @dpe/web dev
```

Vite defaults to `http://localhost:5000` for the API in development. Set `VITE_API_BASE_URL` only when the API is elsewhere. Development CORS permits localhost and 127.0.0.1 on ports 5173 and 5174.

## Authentication and first admin

Public registration always creates an active `viewer`. Refresh tokens are stored only as SHA-256 hashes in PostgreSQL and sent to browsers in an HttpOnly, SameSite=Lax cookie; the JSON response contains only the user and access token. Refresh is rotating and replay-protected. Viewer accounts can read authenticated data, while managers and admins can perform operational mutations. Only admins can manage user roles.

Create the first admin with temporary environment variables after migrations:

```sh
BOOTSTRAP_ADMIN_NAME='Operations Admin' \
BOOTSTRAP_ADMIN_EMAIL='admin@example.com' \
BOOTSTRAP_ADMIN_PASSWORD='Temporary-Strong-Password-123!' \
pnpm auth:bootstrap-admin
```

Do not reuse that literal example. Use a genuinely strong 12–72 character password and shell input that does not save it in history. The command does nothing if any admin already exists and never upgrades an existing account. See [DEPLOYMENT.md](DEPLOYMENT.md) for an interactive and Docker-safe form.

## Workspaces and API capabilities

The authenticated Web app has seven local-state workspaces (no client router):

- Overview: product summary, queue state, product actions, sales and competitor dialogs
- Products: paginated product records, loaded-page search, create/edit for managers/admins
- Scraper Queue: queue health, recent jobs, state filters, failed-job retry
- Price Suggestions: pending, approved, rejected, and expired evidence with human decisions
- Competitor Intelligence: global configured targets and latest trusted exact-match scrape
- Analytics: recorded sales aggregates and global price history
- Settings: account/system state and admin-only role management

Major API capabilities include registration/login/refresh/logout and `/me`; products and bulk sales; competitor targets; scraper job listing/retry/trigger; pricing score/suggestion/rationale/approval/rejection/history; recorded-data analytics; and admin user-role management. `/health` is lightweight liveness, while `/health/ready` checks PostgreSQL readiness only.

## Model boundaries

### Synthetic price score

The operational price-suggestion score is trained on 4,500 synthetic rule-based samples. Its tracked synthetic metrics only show that the model reproduced that bootstrap policy. The score is not confidence, real-market accuracy, causal elasticity, expected uplift, or an automatically selected price. Deterministic API guardrails and human approval remain mandatory.

### Real M5 demand pilot

The tracked demand model uses real M5 historical observations for Walmart store `CA_1`, department `FOODS_1`. The untouched 28-day test metadata reports MAE `1.259822`, RMSE `2.211710`, R² `0.326979`, and WAPE `0.794764`. Those are historical pilot metrics for that narrow split, not Indian-market validation, universal forecast accuracy, or evidence that changing price causes demand.

The demand endpoints predict units for a complete feature row and simulate explicit guarded candidate prices while holding other history/context fixed. They do not select or apply a price.

## Gemini and scraper boundaries

- Gemini is optional. Without `GEMINI_API_KEY`, the API, readiness, pricing decisions, and all non-rationale features remain available. Prompts explain already-computed evidence; Gemini does not choose or apply prices.
- HTTP scraper triggers accept only a configured target ID. The worker re-resolves active target/product data from PostgreSQL, validates public DNS and redirects, limits redirects/HTML size, blocks unnecessary resources, and sanitizes failures.
- `SCRAPER_ALLOW_PRIVATE_URLS` is development/test-only and remains false in production. Puppeteer's independent DNS resolution means the built-in validation cannot provide complete address pinning against DNS rebinding.
- Do not scrape a site unless its terms and applicable law permit it.

## Environment guidance

Use `apps/api/.env.example` for local API settings and `production.env.example` only as a template for an ignored production env file. Important groups are:

- Mandatory secrets/connection values: PostgreSQL credentials/URL, Redis password/URL, distinct JWT access and refresh secrets
- Browser/API boundary: exact `CORS_ALLOWED_ORIGINS`, validated `TRUST_PROXY`
- Session/pricing: JWT lifetimes and `PRICE_SUGGESTION_TTL_HOURS` (default 24, valid 1–720)
- Rate limits: general, auth, and expensive mutation limits; the in-memory store is single-instance only
- Scraper: scheduler, timeout, HTML-byte and redirect limits
- ML/Gemini: internal ML URL/timeouts and optional Gemini key/model limits

Never put real secrets in tracked files, image layers, frontend variables, command output, or logs.

## Production Docker baseline

```sh
cp production.env.example .env.production
# Replace every CHANGE_ME value in the ignored file.
pnpm prod:config
pnpm prod:build
pnpm prod:up
curl http://localhost:8080/health
curl http://localhost:8080/health/ready
```

Only Nginx/Web is published. PostgreSQL, Redis, ML, and API stay on private Compose networks. Nginx serves the SPA, proxies `/api` and `/health`, and adds baseline response headers. Migrations run as a one-shot service before API startup. Full operational steps and backup warnings are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Tests

```sh
pnpm --filter @dpe/api test
pnpm --filter @dpe/web exec tsc --noEmit
pnpm --filter @dpe/web exec vite build

cd apps/ml-service
python -m pip check
python -m compileall -q app scripts tests
python -m unittest discover -s tests -p 'test_*.py'

docker compose --env-file .env.production -f compose.production.yml config
git diff --check
```

The clean-clone-safe ML suite uses in-memory fixtures and tracked artifacts. It does not download the large ignored M5 raw/processed datasets.

## Deployment limitations

This is a portable single-host baseline. It does not provide cloud deployment, TLS termination/HSTS, multi-replica rate limiting or session infrastructure, high availability, managed secret rotation, centralized observability, disaster recovery, or tested backups. Production UI workflows still require operator acceptance testing in the target environment. See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current evidence and remaining work.
