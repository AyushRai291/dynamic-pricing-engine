# Portable Docker production baseline

This repository includes a portable single-host Docker Compose baseline. It is not proof of deployment to any cloud provider and does not replace provider-specific TLS, firewall, monitoring, backup, or high-availability work.

## Prerequisites

- Docker Engine with Docker Compose v2
- Enough memory for PostgreSQL, Chromium, and the tracked XGBoost models (4 GB minimum; 6 GB recommended)
- A reverse proxy or load balancer providing TLS in front of the published Web port

## Configure secrets

Copy `production.env.example` to `.env.production`. The destination is gitignored. Replace every `CHANGE_ME` value with independently generated secrets; keep the PostgreSQL password URL-safe because Compose builds the internal PostgreSQL URL from it. Set `CORS_ALLOWED_ORIGINS` to the exact public Web origin, including its non-default port if applicable. `GEMINI_API_KEY` is optional.

Never commit `.env.production`, pass secrets as image build arguments, or bake them into images.

## Validate and build

```sh
pnpm prod:config
pnpm prod:build
```

The Web image builds with an empty API base by default, so browser requests use same-origin `/api` and `/health` paths through Nginx. Local Vite development continues to use `VITE_API_BASE_URL`.

The API runs as a non-root user with a read-only filesystem. Production Compose explicitly disables Chromium's inner sandbox because the default Docker capability profile blocks its namespace setup; container isolation, `no-new-privileges`, URL/DNS protections, and resource limits remain enforced. If a target platform supports the Chromium sandbox, set `SCRAPER_DISABLE_CHROMIUM_SANDBOX=false` after validating browser startup there.

## Migrate and start

```sh
pnpm prod:up
```

Compose starts PostgreSQL, waits for it to become healthy, runs the one-shot migration service, then starts Redis, ML, API, and Web according to their health checks. The migration runner uses an advisory lock and records applied filenames in `public.schema_migrations`. Re-running the stack skips recorded migrations.

For an explicit migration-only run:

```sh
docker compose --env-file .env.production -f compose.production.yml run --rm migrate
```

The runner intentionally refuses a non-empty database that lacks `schema_migrations`; create a reviewed baseline manually for a legacy database rather than letting deployment guess.

## Verify health

```sh
docker compose --env-file .env.production -f compose.production.yml ps
curl http://localhost:8080/health
curl http://localhost:8080/
```

Change `8080` if `WEB_PORT` differs. PostgreSQL, Redis, ML, and API have no host-published ports. `/health` is proxied by Web/Nginx to the API.

## Logs and shutdown

```sh
pnpm prod:logs
pnpm prod:down
```

`prod:down` preserves the named PostgreSQL and Redis volumes. Do not use `down --volumes` on a real environment unless permanent data removal is explicitly intended.

## Backup warning

Persistent volumes are not backups. Establish and test PostgreSQL logical or physical backups, Redis persistence backups if queue recovery matters, off-host retention, and restoration procedures before relying on this baseline for production data.
