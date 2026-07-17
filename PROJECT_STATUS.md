# Project status

Status date: 2026-07-17. Labels used below are **Complete**, **Manually pending**, and **Future-data blocked**. “Complete” means implemented and covered by the repository checks listed here; it does not mean cloud-deployed or commercially validated.

## Complete

### Web

- Login/registration, current-user loading, rotating-cookie refresh retry, and logout
- RBAC-aware viewer versus manager/admin controls
- Seven responsive workspaces: Overview, Products, Scraper Queue, Price Suggestions, Competitor Intelligence, Analytics, and Settings
- Real API-backed loading, empty, error/retry, and read-only states
- Pending/approved/rejected/expired suggestion tabs and read-only expired detail evidence

### API

- Products, bulk sales, competitor targets, scraper operations, pricing suggestions/decisions/history, recorded analytics, and admin role management
- Human approval transaction with row locking and one price-history insert; rejection/expiry never updates product price or history
- Configurable 1–720 hour suggestion TTL, legacy-null expiry handling, and expiry-safe rationale/decision checks
- Lightweight `/health` liveness plus PostgreSQL-only `/health/ready`
- Sanitized centralized errors with request IDs, validated CORS/trust proxy, and tiered rate limits

### ML and data

- Deterministic feature builder and tracked synthetic bootstrap 0–100 price-score artifact
- Tracked real M5 `CA_1` / `FOODS_1` demand model, preprocessor, metadata, inference, and explicit price-scenario endpoints
- Leakage-aware historical features and chronological train/validation/test metadata
- Clean-clone-safe tests use tracked artifacts/in-memory fixtures; ignored M5 raw/generated data is not required

### Database

- Ordered PostgreSQL migrations through `007_create_auth_sessions_table.sql`
- Products, competitor/sales/price histories, suggestions, users/RBAC, targets, and hash-only refresh sessions
- Advisory-locked migration runner with filename tracking and safe refusal of untracked legacy databases
- First-admin bootstrap that is non-HTTP, advisory-locked, strong-password validated, and no-op when an admin exists

### Security

- Database-backed current roles, viewer-only public registration, and admin-only role changes
- HttpOnly SameSite=Lax refresh cookie, SHA-256 session hashes, atomic rotation, replay rejection, inactive-user rejection, and idempotent logout
- Strict target-ID scraper trigger, active target re-resolution, DNS/redirect SSRF checks, resource limits, and sanitized failures
- Nginx nosniff, referrer, frame, permissions, and React-compatible CSP headers; HSTS intentionally omitted without repository TLS

### Deployment

- Multi-stage Node 22/pnpm 11.10.0 API, Python 3.10 ML, and static Nginx Web images
- Private PostgreSQL/Redis/ML/API services; Web-only published port
- One-shot migrations, persistent data volumes, health-based ordering, restart/graceful-shutdown settings
- Independent GitHub Actions jobs for API, Web, and clean-clone-safe ML validation

## Automated verification record

Final local commands for this pass:

```text
pnpm --filter @dpe/api test
pnpm --filter @dpe/web exec tsc --noEmit
pnpm --filter @dpe/web exec vite build
python -m pip check
python -m compileall -q app scripts tests
python -m unittest discover -s tests -p "test_*.py"
node --check <changed API JavaScript files>
Express app import
nginx -t in the production Web image
git diff --check
docker compose --env-file <temporary verification file> -f compose.production.yml config
production image build and temporary full-stack runtime checks
```

Results from the final verification cycle:

- API full suite: **208/208 passed**. A live database-outage check then exposed an unbounded readiness wait; after the focused timeout fix, the readiness file passed **4/4** without rerunning the full suite.
- Web: TypeScript `--noEmit` passed; Vite production build passed with **2,387 modules transformed** and the emitted JavaScript asset returned HTTP 200 through Nginx.
- ML isolated `.venv`: `pip check` reported no broken requirements, `compileall` passed, and **62/62 tests passed**. The machine-wide Python was not used because unrelated globally installed packages conflict with this repository's pinned NumPy stack.
- Changed API JavaScript syntax checks and Express app import passed. Production Compose configuration parsed successfully.
- Production images rebuilt successfully for API, migration runner, Web/Nginx, and ML. `nginx -t` passed.
- Fresh-stack migrations applied **7/7** files; a second migration run reported `No pending migrations.`
- PostgreSQL, Redis, ML, API, and Web healthchecks passed. Nginx returned the SPA, liveness, readiness, and a built asset successfully.
- With PostgreSQL stopped, liveness stayed HTTP 200 and readiness returned sanitized HTTP 503 in about 3.1 seconds; readiness returned HTTP 200 after PostgreSQL recovery.
- Registration created a viewer; login, cookie rotation, old-token replay rejection, logout revocation, first-admin creation, and second bootstrap no-op all passed.
- The temporary expired suggestion appeared through list/detail APIs with `expiresAt`; rationale, approval, and rejection each returned 409. Source/build checks confirm controls are gated to pending status, but visual interaction remains manually pending below.
- Nginx headers were present on frontend and proxied API responses: nosniff, referrer policy, frame denial, permissions policy, and CSP. HSTS was absent as intended.
- API and ML health remained available with Gemini unconfigured. The API suite exercised the internal deterministic mock-HTML scraper path; no public retailer was contacted.
- `git diff --check` passed after documentation finalization.
- The disposable Compose project, verification users/products/sessions/suggestions, containers, networks, and PostgreSQL/Redis volumes were removed. The two pre-existing development containers were preserved.

## Manually pending

- Target-environment operator acceptance across desktop and mobile breakpoints
- Accessibility audit with assistive technology and keyboard-only operation
- Legal/terms approval and a permitted retailer-specific scraper acceptance run
- TLS/load-balancer, firewall, secret-manager, monitoring/alerting, backup, restore, and incident-response validation
- Browser interaction checks if the local in-app browser cannot connect to the temporary production stack
- Interactive loading of all seven sidebar workspaces and visual confirmation of the expired read-only detail remain pending because this session reported no available browser backend

## Future-data blocked

- Indian or store-specific demand/pricing model retraining requires representative, permissioned historical sales, prices, promotions, inventory, competitor context, and outcomes
- Genuine uplift or causal elasticity claims require controlled experiments or defensible causal data/design; observational M5 simulation cannot establish them
- Meaningful Prophet forecasting requires sufficient, stable product/store time-series history and an agreed forecast target; Prophet is intentionally not added now

## Model and deployment caveats

- Synthetic price-score metrics measure reproduction of a generated policy, not real-world accuracy or business impact.
- Real M5 metrics apply only to the tracked Walmart `CA_1` / `FOODS_1` historical pilot and are not Indian-market validation.
- The Compose baseline is single-host and single-API-instance oriented. It is not high availability or proof of cloud deployment.
- Gemini is optional and explanatory only. Scraping remains target/site permission dependent and DNS validation cannot completely pin Puppeteer's resolved address against rebinding.
