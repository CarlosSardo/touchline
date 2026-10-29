# Touchline engineering guide

This is the operational source of truth for building, testing and running Touchline. For the solution design, runtime boundaries and implementation map, see the [technical documentation](docs/src/content/docs/technical/index.md). For contribution policy and review expectations, see [CONTRIBUTING.md](CONTRIBUTING.md); for gameplay scope and known gaps, see [REQUIREMENTS.md](REQUIREMENTS.md).

## Contents

- [Local development](#local-development)
- [Commands](#commands)
- [Configuration](#configuration)
- [Testing and verification](#testing-and-verification)
- [CI with Dagger](#ci-with-dagger)
- [Hosting and first install](#hosting-and-first-install)
- [Existing PostgreSQL and reverse proxy](#existing-postgresql-and-reverse-proxy)
- [Sign-in and access](#sign-in-and-access)
- [Continuous deployment](#continuous-deployment)
- [Backups and restore](#backups-and-restore)
- [Upgrades and migrations](#upgrades-and-migrations)
- [Saves and legacy careers](#saves-and-legacy-careers)
- [Performance and troubleshooting](#performance-and-troubleshooting)

## Local development

Use **Node.js 24.11 or newer**, npm and Docker Compose, or an existing PostgreSQL 18 instance. [.nvmrc](.nvmrc) selects the repository's Node version; [package.json](package.json) defines the supported commands.

Run these commands from the repository root, against a **new local development database**:

```sh
npm ci
cp .env.example .env
chmod 600 .env
# Edit .env: set distinct POSTGRES_PASSWORD and SQL_PASSWORD values.
docker compose up -d --wait postgres
set -a; . ./.env; set +a
npm run db:migrate
npm run db:migrate -- --apply --yes
npm run db:seed -- --seed touchline-2026 --apply --yes
npm run dev
```

Only source a trusted `.env` you control; it is shell input in the example above. Quote values containing `#` or `$` with single quotes. Compose reads `.env` itself, but host Node commands need the variables exported into their environment.

The UI listens at `http://127.0.0.1:5173`, with `/api` proxied to `127.0.0.1:3001`. To use different ports:

```sh
API_PORT=3011 UI_PORT=5181 npm run dev
```

For a smaller generated world, replace the seed command with:

```sh
npm run db:seed -- --seed touchline-2026 --nations PT,IE --apply --yes
```

Without Docker, set `SQL_HOST`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER` and `SQL_PASSWORD` for PostgreSQL 18. The database must already exist and be owned by the application role. Local development defaults to `SQL_SCHEMA=public` and no sign-in; it does **not** prove hosted authentication or per-account isolation.

Startup never creates the account registry, migrates schemas or seeds a career. Never reseed to repair an existing career.

### Production build on a development machine

```sh
npm run build
npm start
```

The build type-checks client/tooling and server code, then emits the Vite UI into `dist/`. Express serves that directory and the API together on port 3001. Server TypeScript runs through `tsx`; it is not a separate bundled server executable. `npm run preview` previews only the static UI and does not start the game engine.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch the API and run Vite with live reload |
| `npm run build` / `npm start` | Build, then serve UI and API together |
| `npm run lint` / `npm run format` | Run oxlint / format registered source paths with Prettier |
| `npm run db:migrate` | Print an offline migration plan; `-- --apply --yes` applies pending versions |
| `npm run db:migrate -- --registered` | Plan world migrations for the account registry; add `--apply --yes` to resolve and migrate registered worlds |
| `npm run db:seed -- ...` | Generate a world; intended for a new empty development target |
| `npm run accounts:migrate` | Dry run of account-registry provisioning; `-- --apply --yes` creates or validates it |
| `npm run career:delete -- --account ID` | Dry run of deleting one active career, keeping the account; also accepts `--username`, `--email`, `--list`; deletion needs `--apply --yes` |
| `npm run data:export -- --out FILE.touchline.gz` | Export the selected world |
| `npm run data:export -- --everything --out-dir DIR` | Export registry, worlds and snapshots with a manifest |
| `npm run data:export -- --verify DIR` | Verify a full portable backup offline |
| `npm run world:reset -- --all` | Dry run of emptying worlds and snapshots, retaining registry and migrations; mutation needs `--apply --yes` |
| `npm run db:footprint` | Read-only per-table storage report, including the 1.6 GB world budget |
| `npm run world:check` | Generate/check an isolated test world; optional `-- --nations=EN,ES` |
| `npm run simulation:check` | Compare a 600-match sample to aggregate targets; `-- --seasons=3` runs a storage-aware season soak |
| `npm run image:build` | Build `touchline:local` for the local architecture |
| `npm run ci` | Run the same containerized pipeline as GitHub Actions |
| `npm run pi:backup` / `npm run pi:restore -- FILE --yes` | Back up / replace the database of the bundled Compose PostgreSQL service |

Inspect the script's `--help` and target before administrative commands. Dry-run flags are not interchangeable with permission to mutate production. Export files and registry backups contain private data and must not be committed.

## Configuration

[.env.example](.env.example) is the configuration inventory. Keep secrets in the ignored `.env`, not in images, source, logs or exported command output.

| Area | Variables and defaults |
| --- | --- |
| SQL connection | `SQL_HOST=127.0.0.1`, `SQL_PORT=5432`, `SQL_DATABASE=touchline`, paired `SQL_USER` / `SQL_PASSWORD` |
| SQL behavior | `SQL_SCHEMA=public`, `SQL_POOL_SIZE=10`, `SQL_REQUEST_TIMEOUT_MS=120000` |
| SQL transport | `SQL_SSL=disable` for loopback/private Compose networking; non-local hosts require `verify-full` |
| HTTP listener | `API_HOST=127.0.0.1`, `API_PORT=3001`; `PORT` overrides `API_PORT` |
| Compose PostgreSQL | `POSTGRES_PASSWORD`, `POSTGRES_PUBLISH_PORT=5432`; app role is separate from the superuser |
| Compose app | `TOUCHLINE_IMAGE`, `TOUCHLINE_BIND=127.0.0.1`, `TOUCHLINE_PORT=3001`, `TOUCHLINE_NODE_OPTIONS=--max-old-space-size=1536` |
| HTTPS | `TOUCHLINE_DOMAIN` for the optional Caddy profile |
| Access limits | `MAX_PLAYERS=10`, `DB_SIZE_LIMIT_GB=24`; checked when approving access |
| Backup retention | `BACKUP_DIR=backups`, `BACKUP_RETENTION_DAYS=14` |

The current API configuration parser requires `MAX_PLAYERS` to be a **positive integer**. Although the example's comment describes `0` as admins-only, that value currently prevents startup; use a positive cap until implementation and examples are aligned.

`SQL_POOL_SIZE` accepts 2-100 and request timeouts 1,000-900,000 ms. Keep PostgreSQL `max_connections` above application pools plus administrative sessions. Do not copy test-only durability settings into production.

Removed Azure SQL variables (`SQL_SERVER`, `SQL_ENCRYPT`, `SQL_TRUST_SERVER_CERTIFICATE`, `AZURE_SQL_SERVER`) and SQLite variables (`GAME_DB`, `SAVE_DIR`) are rejected. Old Microsoft object-ID allow-list settings are also rejected; email/SMTP settings are obsolete and ignored with warnings.

## Testing and verification

Use a disposable target, never a player's career:

```sh
npx playwright install chromium
npm run test:local -- npm run verify
npm run test:local -- npm run verify -- --parallel
npm run test:local -- npx vitest run server/draw.test.ts
```

`test:local` starts PostgreSQL 18 on `127.0.0.1:54329` using Compose project `touchline-checks` and [deploy/compose.test.yaml](deploy/compose.test.yaml). Generated credentials stay in ignored `.env.test.local`. It selects the `touchline_checks` database and enables SQL integration/save suites. With no command it runs `npm test`.

For an already-running **loopback** PostgreSQL, export `SQL_HOST`, `SQL_PORT`, `SQL_USER`, `SQL_PASSWORD`, then use:

```sh
npm run test:local -- --no-docker -- npx vitest run server/draw.test.ts
```

The role must be able to create `touchline_checks` if absent. This wrapper rejects remote hosts. Lower-level remote test configuration requires both `SQL_ALLOW_REMOTE_TESTS=true` and `SQL_TEST_DATABASE` exactly matching `SQL_DATABASE`, plus verified TLS for remote hosts; this is not permission to use production.

`verify` runs lint, production build, SQL-backed Vitest tests and Playwright. Its parallel mode uses per-job databases and writes logs under `reports/`. Tests use real schema migrations in isolated `touchline_test_` / `touchline_e2e_` schemas. Browser `TEST_URL` must point to a dedicated test instance.

Hosted OIDC discovery, reverse-proxy behavior and real approval/isolation flows require separate environment validation; local no-auth and synthetic-principal tests do not establish them.

## CI with Dagger

[scripts/ci.sh](scripts/ci.sh), exposed as `npm run ci`, is the shared local/GitHub entrypoint. Pipeline implementation lives in [.dagger/modules/touchline-ci/src/index.ts](.dagger/modules/touchline-ci/src/index.ts), not in duplicated workflow steps.

Docker must be available. The script downloads the pinned, checksum-verified Dagger CLI into the user's cache and runs a local engine. No Dagger Cloud token or cloud engine is used; telemetry is disabled and a temporary empty Docker configuration keeps host registry logins out of test runs.

```sh
npm run ci
npm run ci -- backend,e2e
npm run ci -- backend --shard=2/3
npm run ci -- world --seasons=5 --full-world
npm run ci -- image
npm run ci -- timings
npm run ci -- dagger check -l
```

| Suite | Coverage |
| --- | --- |
| `static` | Lint, production build and SQL-free unit tests, plus generated SDK consistency |
| `backend` | SQL integration/save tests, balanced into 3 database-isolated shards |
| `world` | Catalog checks, world invariants, 3-season soak by default, footprint and backup/reset smoke |
| `e2e` | Playwright in the official browser image, 2 spec-file shards with separate SQL and servers |

`all` gates on `static`, then runs backend/world/e2e in parallel. Steps within a suite record their exit status and continue to collect diagnostics; failed static prevents the remaining suites from starting. Logs/reports/status files are exported to `ci-logs/<suite>/`, and any failed step makes the entrypoint fail.

Shards use [scripts/ci/test-timings.json](scripts/ci/test-timings.json); `timings` refreshes those weights from the previous run. A local TCP forwarder preserves the test loopback boundary while reaching each Dagger PostgreSQL service. Shards must cover each file exactly once.

After changing the Dagger module, regenerate and commit its SDK artifacts:

```sh
npm run ci -- dagger generate -y
```

## Hosting and first install

The supported hobby topology is an arm64/amd64 Linux host with Docker; the reference host is a Raspberry Pi 4B with 8 GB RAM, 64-bit OS and an SSD. PostgreSQL and the application share that host. Do not add cloud infrastructure or always-on services as an incidental deployment change.

The root [compose.yaml](compose.yaml) contains:

| Service | Boundary |
| --- | --- |
| `postgres` | Official PostgreSQL 18; `postgres-data` volume mounted at `/var/lib/postgresql`; host port loopback-only |
| `app` | React static UI and Express API; loopback host port 3001; 2 GB memory limit |
| `caddy` | Optional `https` profile; ports 80/443 and persistent TLS/config volumes |

The first PostgreSQL initialization creates a non-superuser owner role from `SQL_USER` / `SQL_PASSWORD`. The `postgres` superuser is for administration and backups, not application traffic. Changing those environment values later does not re-run the initialization script on an existing volume.

Install Docker using its supported host instructions and give the deploy user appropriate access. Clone the repository, create a mode-600 `.env`, set passwords, domain and all required hosted sign-in settings described below. Register the OIDC client before starting the application.

For a private GHCR package, authenticate with `docker login ghcr.io` using read-only package access. Alternatively, `docker compose build app` builds on the host. Then:

```sh
docker compose up -d --wait postgres
docker compose run --rm app npm run accounts:migrate
docker compose run --rm app npm run accounts:migrate -- --apply --yes
docker compose --profile https up -d --wait
```

Hosted installs provision the account registry, **not** a seeded shared world. Admins receive an empty world on first sign-in; approved players receive theirs on approval and start their career in the UI.

### HTTPS

The optional Caddy profile uses [deploy/Caddyfile](deploy/Caddyfile). `TOUCHLINE_DOMAIN` must resolve to the host, with 80/443 reachable for HTTPS issuance and traffic.

With an existing proxy or tunnel, leave `TOUCHLINE_BIND=127.0.0.1`, forward to `TOUCHLINE_PORT`, set `APP_ORIGIN` to the exact public HTTPS origin and `TRUST_PROXY` to the number of trusted proxy hops. Do not expose PostgreSQL. Touchline performs OIDC itself; a proxy `forward_auth` configuration is not required.

## Existing PostgreSQL and reverse proxy

[deploy/compose.external-postgres.yaml](deploy/compose.external-postgres.yaml) runs **only the app**. Put it as `compose.yaml` beside the host's `.env`, outside the source checkout if necessary. Provision a PostgreSQL 18 database and non-superuser owner role first.

Set `SQL_HOST` to the database container's network name, `POSTGRES_NETWORK` to its existing Docker network (default `postgres`), and explicitly set `TOUCHLINE_PORT` to the loopback port expected by the proxy. The app must reach `OIDC_ISSUER` over HTTPS from inside its container. If the hostname only resolves on the host, an operator-managed `extra_hosts` mapping may be needed.

Provision the registry with `docker compose run --rm app npm run accounts:migrate -- --apply --yes`, then start with `docker compose up -d --wait`. This variant does not include a PostgreSQL service: the bundled `pi:backup` / `pi:restore` scripts are **not directly compatible** with it. Back up the shared database using that stack's operator procedure.

### Deploying from a checkout

[scripts/deploy.sh](scripts/deploy.sh) targets the external-PostgreSQL variant, not the bundled root stack. On the host, prepare `~/touchline/.env` (override the directory with `TOUCHLINE_DIR`) and its existing database/network/proxy. Host prerequisites are Docker, `curl`, `flock`, and buildx for `--build`.

```sh
scripts/deploy.sh <ssh-host>
scripts/deploy.sh <ssh-host> <git-ref>
scripts/deploy.sh --build <ssh-host> <git-ref>
scripts/deploy.sh local
```

The script deploys the **committed** git archive, not uncommitted workspace files. It stages the source and pulls `ghcr.io/carlossardo/touchline:sha-<full-commit>`, or builds the archive on the host with `--build`. Published SHA tags come from verified `main` releases; an unpublished commit needs `--build`.

Manual private pulls require a host `docker login ghcr.io` with `read:packages`, or `GHCR_USER` / `GHCR_TOKEN` for a one-off temporary login. The token travels over SSH standard input, not a command-line argument, and temporary credential files are removed.

[deploy/host-deploy.sh](deploy/host-deploy.sh) serializes deployments with `.deploy.lock`, waiting up to 15 minutes. It verifies the pulled image's OCI revision against the full commit before switching source, installs the external Compose file, provisions/validates the registry, migrates registered worlds, starts the app and checks `/api/health`. It tags the image `local/touchline:<short-revision>` and `:latest`, retains three recent revision tags, and sets `TOUCHLINE_PULL_POLICY=never`. Do not replace these images with an unrelated `docker compose pull`.

A pull or image-revision failure leaves the running container untouched. A migration or startup failure may leave migrated data; restore a matching backup rather than running an older image against it. The deployment script does **not** automatically take a database backup.

Pi configuration changes must also be reflected in the host's source-of-truth repository, [CarlosSardo/raspberry-pi-4b-bootstrap](https://github.com/CarlosSardo/raspberry-pi-4b-bootstrap); do not leave untracked host-only drift.

## Sign-in and access

Hosted mode uses Authorization Code + PKCE through `openid-client`, with a confidential OIDC client using `client_secret_basic`. Register `https://<host>/auth/callback` and scopes `openid profile email groups`.

| Setting | Meaning |
| --- | --- |
| `REQUIRE_AUTH=true` | Mandatory for any non-loopback API listener, including inside the image |
| `APP_ORIGIN` | Exact public HTTPS origin, with no trailing path or slash |
| `OIDC_ISSUER` | Exact issuer URL advertised by provider discovery |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Client ID and plain client secret |
| `OIDC_LOGOUT_URL` | Optional provider sign-out page if discovery has no suitable end-session endpoint |
| `SESSION_SECRET` | At least 32 characters, distinct from client secret; generate with `openssl rand -base64 48` |
| `SESSION_TTL_HOURS` | 1-720 hours, default 8 |
| `TRUST_PROXY` | Trusted proxy hops, typically 1 |
| `ADMIN_GROUP` | Signed-in provider group for access administration, default `admins` |

For Authelia 4.39, generate a client secret/hash with `authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986`. Store the random password only in Touchline's `.env` and the digest in Authelia. Add this to an **already configured** OIDC provider (its `hmac_secret` and `jwks` are separate prerequisites):

```yaml
identity_providers:
  oidc:
    claims_policies:
      touchline:
        id_token: ['groups', 'email', 'email_verified', 'name', 'preferred_username']
    clients:
      - client_id: 'touchline'
        client_name: 'Touchline'
        client_secret: '<generated PBKDF2 digest>'
        public: false
        authorization_policy: 'two_factor'
        consent_mode: 'implicit'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris: ['https://touchline.example.com/auth/callback']
        scopes: ['openid', 'profile', 'email', 'groups']
        response_types: ['code']
        grant_types: ['authorization_code']
        token_endpoint_auth_method: 'client_secret_basic'
        userinfo_signed_response_alg: 'none'
        claims_policy: 'touchline'
```

Restart/reload Authelia through its own operations process. Touchline reads claims from ID token and UserInfo; configure `OIDC_LOGOUT_URL=https://auth.example.com/logout` when the provider has no end-session endpoint.

Sign in first as an `ADMIN_GROUP` member. For each new player, create their provider identity, let them sign in once to record a pending request, then approve it at `/admin`. The player selects **Check again** and starts a career. Denied requests may be approved later. Admin accounts provision automatically and do not count toward the player cap.

Identity and world ownership use `(issuer, subject)`, never email, display name, sporting-director name or client-supplied schema/save IDs. Do not hand-add accounts or bypass approvals.

There is no in-app access revocation. Disable/delete the provider account to prevent future sign-in; an existing Touchline session remains valid until expiry. Deleting a career with `career:delete` keeps its account and is not access revocation.

## Continuous deployment

[ci.yml](.github/workflows/ci.yml) verifies PRs, pushes to `main` and manual dispatches. A push can reuse a successful PR run only when its git tree matches exactly. Docs/editor-only changes matching workflow `paths-ignore` skip game CI and do not trigger CD. This is path-based, not a semantic guarantee: site source/configuration changes outside those ignore patterns may still run game CI.

[cd.yml](.github/workflows/cd.yml) starts after successful push CI and reconciles every six hours. [scripts/ci/cd.sh](scripts/ci/cd.sh) chooses the newest ancestor of `main` with successful push CI, recomputes the candidate at release steps, and refuses downgrade deployments. A newer failing commit does not block the last verified one.

GitHub-hosted runners run `scripts/ci.sh publish`, building/verifying `linux/amd64` and `linux/arm64` images tagged `sha-<commit>` and `latest`. Only deployment runs on the Pi's `touchline-deploy` self-hosted runner, in GitHub environment `production`. It uses `scripts/deploy.sh local` with the job's short-lived package token, then checks the running revision and health.

Register or rebuild the runner from a checkout with repository-admin `gh` authentication:

```sh
scripts/ci/install-runner.sh <ssh-host>
ssh <ssh-host> systemctl --user status actions-runner
ssh <ssh-host> journalctl --user -u actions-runner
```

The runner uses `~/actions-runner`, an auto-updating systemd user service with lingering, and outbound HTTPS to GitHub. Its job-start hook refuses anything except the `deploy` job of `cd.yml` on `main`. The deploy user has Docker privileges; anyone able to change `main` can change what runs on the host. Do not use this runner for PR/build/test jobs.

Transient GitHub API reads retry; the actual deploy is not automatically repeated inside a run. Re-run CD after fixing failures. After a manual deployment outside CD, dispatch CD manually: scheduled reconciliation trusts GitHub's production deployment record, not a fresh host probe. Avoid `[skip ci]` on `main`, since that commit will not itself become verified.

## Backups and restore

### Bundled Compose database

```sh
bash scripts/pi-backup.sh
```

The script takes a consistent online `pg_dump` custom-format database backup and a roles SQL file, verifies the dump is readable, then prunes matching backups older than the retention period. It covers accounts, worlds and snapshots. Files are created with restrictive permissions; copy them off the host and periodically rehearse restoration to a disposable environment. A readable archive is not proof of a successful disaster recovery.

Schedule daily from the checkout containing the root Compose stack, after ensuring the log directory exists:

```cron
15 4 * * * cd /opt/touchline && bash scripts/pi-backup.sh >> backups/backup.log 2>&1
```

To replace the **entire database**, including all players' careers and accounts:

```sh
bash scripts/pi-restore.sh backups/touchline-<stamp>.dump --yes
```

Restore validates the archive, takes a safety backup before stopping the app, recreates the database with the application owner, restores in one transaction, analyzes and restarts the app. A failed restore leaves the app stopped. On a replacement host, start PostgreSQL with the same configuration first so the application role exists; the roles dump is not automatically replayed by this restore script.

### Portable backup

```sh
npm run data:export -- --everything --out-dir <new-backup-directory>
npm run data:export -- --verify <backup-directory>
```

This exports the registry, each world and saved checkpoints with byte counts, SHA-256 hashes and `manifest.json`. Inspect `complete` and failures, not just command output. Protect the registry's personal data. This format is useful across engine generations, but is not a one-command substitute for the full PostgreSQL disaster-recovery path.

For the external-PostgreSQL deployment, use the existing database stack's full backup/restore procedure and the portable exporter as an additional layer.

## Upgrades and migrations

Back up **before** every upgrade or migration. For the bundled stack, after reviewing the target version:

```sh
bash scripts/pi-backup.sh
git pull
docker compose pull app
# Or build a reviewed checkout: docker compose build app
docker compose run --rm app npm run db:migrate -- --registered
docker compose run --rm app npm run db:migrate -- --registered --apply --yes
docker compose --profile https up -d --wait
```

Use this sequence only for the bundled image-pull/build topology, not the `local/touchline` deployment managed by `deploy.sh`. Pin `TOUCHLINE_IMAGE` to a published `@sha256:...` digest for reproducibility. Rollback means restoring compatible data and image together, not pointing an older image at migrated data.

Migration dry runs print the known migration list **without connecting to SQL**; they do not prove which versions are pending or that target accounts are valid. Apply validates registered schemas, refuses missing worlds rather than recreating them, and applies pending numbered migrations. The registry is provisioned separately with `accounts:migrate`.

| World migration | Change |
| --- | --- |
| 1 | Baseline world and save structures |
| 2 | Narrow/update-friendly player storage |
| 3-5 | GBE evidence, registrations and club-offer index |
| 6 | Sanctions and removal of old market indexes |
| 7 | Infrastructure projects and world-feed index |
| 8 | Owners, club ownership and ownership events |
| 9 | Player honours, injuries and milestones |
| 10 | Competition top-scorer index |
| 11 | Indexed height/weight copies from player profiles |

Migration 2 rewrites player storage and can take longer; migration 11 backfills body columns. Do not interrupt a migration just because it exceeds a normal request's expected duration. New tables may be populated lazily on later load/day passes; migration does not regenerate the world.

For schema work, append the next unused migration in [server/sql-schema.ts](server/sql-schema.ts), never edit shipped migrations. Register new world tables in `WORLD_TABLES`, identity tables in `IDENTITY_TABLES`, and compatible later additions in `ADDED_WORLD_TABLES`. Test migration of an existing world and import of an older checkpoint. The store rejects schemas migrated by newer code.

A PostgreSQL major upgrade is a separate maintenance operation: rehearse dump/restore into a fresh major-version cluster, verify it, preserve the original volume until recovery is proven, and switch explicitly. Do not simply change the image tag over an existing data directory.

## Saves and legacy careers

The live career is already persisted in PostgreSQL. **Settings > Saves** manages snapshot slots and portable `.touchline.gz` files; importing/restoring replaces only the selected account's active world. Make a named save before replacement.

Automatic slots rotate at 3 and manual slots at 10; imported checkpoints are protected from automatic rotation. Checkpoints live in PostgreSQL (`save_slots`, `save_chunks`), not a persistent local save directory. Temporary files under `/tmp` support streaming, not durable storage.

World versions before 4 cannot be imported. Older compatible version-4 saves can omit later-added tables; registrations/GBE and living-world data are repaired or backfilled by their current lazy paths. Existing injury history before those systems existed cannot be reconstructed. Transfer/loan offer frequency defaults to Medium when absent.

The retired Azure SQL database cannot be attached to PostgreSQL. Export each career as `.touchline.gz` while its compatible old application still runs; after approval on the new host, start a career and import in **Settings > Saves**. Keep exports until players confirm recovery. SQLite-era careers require an earlier compatible converter/release before portable export; the current runtime/import tools do not read SQLite. Preserve original databases and companion files offline.

## Performance and troubleshooting

Use an SSD, active cooling and a 64-bit OS on the Pi. Root Compose tunes PostgreSQL for 8 GB shared RAM, including `shared_buffers=1GB`, `effective_cache_size=4GB`, SSD costs, `jit=off`, compressed WAL and longer checkpoints. Other hosts need their own capacity review.

Simulation is CPU- and SQL-heavy work in the API process, not a background worker service. Large careers may take minutes to generate on a Pi. Heap is capped at 1536 MB within a 2 GB container; raise both deliberately if measured pressure requires it.

Each day commits separately. A failure after completed days returns progress plus an error; those days remain persisted. A first-day failure uses the normal error response. Other world actions/read views wait or receive `409 world_busy` during an operation; session/activity polling remains available.

| Symptom | Check / response |
| --- | --- |
| UI opens but game data fails | `/api/health` is liveness only and does not open SQL; inspect `docker compose logs app` and the authenticated `/api/health/details` |
| Uninitialized local career | Confirm the intended development target; migrate/seed a new empty one, never reseed a real career |
| Missing registry or registered schema | Correct provisioning/target or restore data; startup deliberately refuses to invent missing worlds |
| Public binding refused | Set genuine hosted authentication; do not weaken the loopback/auth guard |
| OIDC callback/discovery fails | Check exact HTTPS origin, redirect URI, issuer, container DNS/TLS reachability and proxy-hop configuration |
| Signed in but waiting/denied | Use an admin's `/admin` approval flow; identity alone is not authorization |
| Proxy returns 502 after deploy | Check explicit `TOUCHLINE_PORT` in host `.env` matches the proxy and container is running |
| SHA image cannot be pulled | Confirm verified release was published and package read permission; unpublished refs need a deliberate `--build` |
| Deploy migration/start failure | Inspect logs and restore a matching database backup if rollback is required |
| Large database / slow simulation | Run `db:footprint`, inspect PostgreSQL slow-query logs and reproduce with an isolated season soak |

Unexpected API failures log operation, method/path, SQLSTATE and stack with configured secrets redacted; request bodies/SQL parameters are not logged. PostgreSQL logs statements slower than 2 seconds in the reference Compose setup. Do not upload personal saves or raw credentials when reporting problems.

Player storage uses out-of-line profile data, update-friendly fillfactor and targeted vacuuming after busy/weekly/rollover passes. Retention compacts un-followed match detail and prunes bounded batches rather than retaining every full replay forever. The soak enforces a 10 KB/player-row budget and fixture-scaled seasonal growth, with a 1.75 first-season allowance. Run it without another client's long transaction or concurrent soak holding old snapshots; otherwise measured bloat can misrepresent steady-state growth. Do not raise budgets to hide regressions.

Historical desktop measurements in earlier documentation are not Raspberry Pi performance guarantees. Measure the actual target before promising generation or simulation latency.
