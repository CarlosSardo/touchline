<div align="center">

# ⚽ Touchline

**A football sporting-director simulation, self-hosted on a Raspberry Pi**

[![Verify](https://github.com/CarlosSardo/touchline/actions/workflows/verify.yml/badge.svg)](https://github.com/CarlosSardo/touchline/actions/workflows/verify.yml)
[![Image](https://github.com/CarlosSardo/touchline/actions/workflows/image.yml/badge.svg)](https://github.com/CarlosSardo/touchline/actions/workflows/image.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)

[![Node.js 22](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Express 5](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL 18](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

[![Docker multi-arch](https://img.shields.io/badge/Docker-arm64%20%7C%20amd64-2496ED?logo=docker&logoColor=white)](Dockerfile)
[![Raspberry Pi 4](https://img.shields.io/badge/Raspberry%20Pi-4B%208GB-A22846?logo=raspberrypi&logoColor=white)](#hosting-on-a-raspberry-pi)
[![OpenID Connect](https://img.shields.io/badge/sign--in-OpenID%20Connect-F78C40?logo=openid&logoColor=white)](#sign-in-and-access)
[![Authelia](https://img.shields.io/badge/Authelia-2FA-113155?logo=authelia&logoColor=white)](https://www.authelia.com)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](#testing)
[![Playwright](https://img.shields.io/badge/e2e-Playwright-2EAD33?logo=playwright&logoColor=white)](#testing)

</div>

Touchline is a football sporting-director simulation. You take charge of a club's long-term project on **1 July 2026**: recruitment, contracts, squad planning, the academy, staff, facilities and finances. The manager picks the team and plays the matches; your job is to give them the right players and keep the club healthy for years to come.

- Self-host it: one Docker Compose stack (PostgreSQL 18 + the app, optional Caddy for HTTPS) runs on a Raspberry Pi 4 (8 GB, SSD) or any 64-bit Linux host. Hosted access is for a small private group: players sign in through your own OpenID Connect provider (for example [Authelia](https://www.authelia.com)), and an admin approves each new player once at `/admin`.
- Current status and known gaps: [REQUIREMENTS.md](REQUIREMENTS.md)
- How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md)

## Features

- **A large procedural world:** 211 football associations, 107 of them with their own league pyramid of one to six tiers (England six), B teams, U19/U17 leagues, national cups and continental competitions.
- **Internationals:** Senior, U21, U20, U19 and U17 national teams, UEFA youth qualifying and the main youth tournaments; caps on player dossiers and a club policy for releasing players outside FIFA windows.
- **Call-ups:** temporary moves between the club's own teams (next match, a number of days, until a date), coach call-ups or proposals, a debut budget per season and up to three development requests.
- **Scouting and transfers:** uncertain scout reports, shortlists and multi-stage deals with instalments, buy-back, sell-on, seller loan-back and pre-contract options; rival bids, best-and-final rounds, future arrivals and affiliate placements; transfer history per player and per club.
- **Loans and youth recruitment:** nine loan types, incoming/outgoing loan offers with borrower counters, recalls, purchase clauses, affiliate development loans and modelled FIFA rules for minors.
- **Squad and academy:** first team, reserve club, U19 and U17 groups, development plans, mentors and squad roles.
- **A living club:** staff, facilities, board and press decisions, an affiliate network and unexpected events.
- **Match analysis:** reproducible simulation with ratings, xG, xA, xPts and interactive pitch maps.
- **Media and supporters:** fictional journalists, a news feed and supporter reactions.
- **Saves and settings:** PostgreSQL persistence, autosaves, portable `.touchline.gz` exports, colour modes, themes and eight display currencies.

All names, clubs, attributes and results are procedurally generated, not licensed real-world records.

## Quick start

You need **Node.js 22.13 or newer** (see [.nvmrc](.nvmrc)), npm and Docker (or an existing PostgreSQL 18).

```sh
npm ci
cp .env.example .env               # set POSTGRES_PASSWORD and SQL_PASSWORD; never commit .env
docker compose up -d --wait postgres # PostgreSQL 18 on 127.0.0.1:5432; creates the touchline database and role
set -a; . ./.env; set +a           # load .env without printing it
npm run db:migrate                 # review the plan, then:
npm run db:migrate -- --apply --yes
npm run db:seed -- --seed touchline-2026 --apply --yes # new, empty database only; add --nations PT,IE for a small world
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173); the API runs on `127.0.0.1:3001`.

- Without Docker, point `SQL_HOST`/`SQL_PORT`/`SQL_USER`/`SQL_PASSWORD` at a PostgreSQL 18 whose database (`SQL_DATABASE`) is owned by `SQL_USER`.
- Startup never migrates the schema or generates a world. Never reseed to repair an existing career.
- Local development runs without sign-in, so it does not exercise OpenID Connect authentication or per-account isolation.
- All settings are environment variables, listed with local defaults in [.env.example](.env.example).

## Commands

| Command                             | What it does                                                            |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                       | UI (5173) and API (3001) with live reload                               |
| `npm run build` then `npm start`    | Build and serve the production UI and API together on port 3001         |
| `npm run lint` / `npm run format`   | Lint with oxlint / format with Prettier                                 |
| `npm run db:migrate`                | Show pending schema migrations; add `-- --apply --yes` to apply         |
| `npm run db:seed -- ...`            | Generate a world in a new, empty database                               |
| `npm run accounts:migrate`          | Dry run of creating/validating the account registry (players and access requests) for hosted sign-in; `-- --apply --yes` applies |
| `npm run career:delete -- --account ID` | Dry run of deleting one account's active career (also `--username NAME`, `--email ADDRESS`, `--list`); `--apply --yes` deletes it, the account stays |
| `npm run data:export -- --out FILE` | Export the active world to a portable `.touchline.gz` file              |
| `npm run data:export -- --everything --out-dir DIR` | Back up the registry, every world and snapshot with `manifest.json`; `--verify DIR` checks it offline |
| `npm run world:reset -- --all`      | Dry run of emptying every world and snapshot; `--apply --yes` performs it (keeps accounts and migrations) |
| `npm run db:footprint`              | Read-only per-table size report; flags worlds over 1.6 GB                |
| `npm run world:check`               | Generate the world in a test schema and check its invariants; prints one JSON line, exits 1 on a violation (`-- --nations=EN,ES`) |
| `npm run simulation:check`          | Compare a 600-match sample with real aggregates (`-- --seasons=3` soak) |
| `npm run image:build`               | Build the Docker image for this machine's architecture (`touchline:local`) |
| `npm run pi:backup` / `npm run pi:restore` | Back up / restore the compose stack's PostgreSQL database (see [Backups](#backups-and-restore)) |

If ports are taken: `API_PORT=3011 UI_PORT=5181 npm run dev`. `npm run preview` serves only the static build, not the game engine.

## Testing

`npm run test:local` starts a disposable PostgreSQL 18 container on `127.0.0.1:54329` (Compose project `touchline-checks`, password in the ignored `.env.test.local`) and runs `npm test`, or any command after `--`. Without Docker, `--no-docker` uses an already-running loopback PostgreSQL from `SQL_HOST`, `SQL_PORT`, `SQL_USER` and `SQL_PASSWORD`; both modes create and use the `touchline_checks` database:

```sh
npx playwright install chromium   # once, for browser tests
npm run test:local -- npm run verify
npm run test:local -- npm run verify -- --parallel
npm run test:local -- --no-docker -- npx vitest run server/draw.test.ts
```

`npm run verify` runs lint, the production build, SQL-backed unit/integration/save tests and the Playwright suite; `--parallel` runs them as concurrent jobs in per-job databases and writes logs to `reports/`. Tests use the real schema in isolated `touchline_test_` / `touchline_e2e_` schemas and must never target a player's world. Remote-database rules and guards are in [CONTRIBUTING.md](CONTRIBUTING.md). The manual/PR GitHub Actions workflow [verify.yml](.github/workflows/verify.yml) runs the same suites against a throwaway PostgreSQL 18 container.

## Hosting on a Raspberry Pi

The production stack in [compose.yaml](compose.yaml) runs on a Raspberry Pi 4 Model B (8 GB) with an SSD and 64-bit Raspberry Pi OS, or on any arm64/amd64 Linux host with Docker:

- `postgres`: the official `postgres:18` image, data in the `postgres-data` volume, published only on `127.0.0.1:5432`, tuned for 8 GB RAM and an SSD (`shared_buffers=1GB`, `effective_cache_size=4GB`, `random_page_cost=1.1`, `jit=off`, compressed WAL, 15-minute checkpoints). On first start [deploy/postgres/initdb](deploy/postgres/initdb/10-touchline-role.sh) creates `SQL_USER` as a non-superuser owner of `SQL_DATABASE`; the `postgres` superuser is only for administration and backups.
- `app`: the multi-arch image `ghcr.io/carlossardo/touchline` built by [image.yml](.github/workflows/image.yml) on every push to `main` (or built locally from the [Dockerfile](Dockerfile)), React UI and Express API on `127.0.0.1:3001`, 2 GB memory limit.
- `caddy` (Compose profile `https`): automatic Let's Encrypt HTTPS for `TOUCHLINE_DOMAIN` with [deploy/Caddyfile](deploy/Caddyfile).

### First install

1. Install 64-bit Raspberry Pi OS, boot from the SSD and install Docker (`curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER`).
2. Clone the repository (for example to `/opt/touchline`) and create the configuration: `cp .env.example .env && chmod 600 .env`. Set `POSTGRES_PASSWORD` and `SQL_PASSWORD` (`openssl rand -hex 24`), `TOUCHLINE_DOMAIN`, and uncomment the sign-in settings (`REQUIRE_AUTH=true`, `APP_ORIGIN=https://<TOUCHLINE_DOMAIN>`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_LOGOUT_URL`, `SESSION_SECRET`, `TRUST_PROXY=1`, and `ADMIN_GROUP` unless your admin group is `admins`). The app refuses to listen beyond loopback without sign-in.
3. Register Touchline as an OpenID Connect client at your provider, as described in [Sign-in and access](#sign-in-and-access).
4. If the GHCR package is private, `docker login ghcr.io` with a token that has `read:packages`. Without a registry, `docker compose build app` builds the image on the Pi (several minutes).
5. Start the database, create the account registry and start everything:

```sh
docker compose up -d --wait postgres
docker compose run --rm app npm run accounts:migrate                  # dry run: review it
docker compose run --rm app npm run accounts:migrate -- --apply --yes
docker compose --profile https up -d --wait
```

Admins get an empty world on their first sign-in; other players get theirs when an admin approves them at `/admin`. Each player then starts a career in the app. Startup never migrates or seeds.

### Existing PostgreSQL and reverse proxy

If the host already runs PostgreSQL 18 in Docker and a reverse proxy, run only the app with [deploy/compose.external-postgres.yaml](deploy/compose.external-postgres.yaml): copy it as `compose.yaml` next to a `.env`, create the database and an owner role for it (no superuser rights needed), and set `POSTGRES_NETWORK` to the Docker network PostgreSQL is on (default `postgres`) and `TOUCHLINE_PORT` to the loopback port your proxy forwards to. Create the account registry once with `docker compose run --rm app npm run accounts:migrate -- --apply --yes` before `docker compose up -d --wait`. To build the image on the host instead of pulling it, use `docker buildx build --load -t local/touchline:latest .` (Ubuntu's `docker.io` package has no buildx: install `docker-buildx`, or the static binary into `~/.docker/cli-plugins/`) and set `TOUCHLINE_IMAGE=local/touchline:latest`. Since the role is only the database owner, tune it per database, for example `ALTER DATABASE touchline SET random_page_cost = 1.1`, `effective_io_concurrency = 200`, `work_mem = '16MB'`, `jit = off`.

Sign-in works the same as above ([Sign-in and access](#sign-in-and-access)): point `OIDC_ISSUER` at your provider (for example Authelia behind the same proxy), set `OIDC_LOGOUT_URL` to its `/logout` page and `TRUST_PROXY=1`. The app container itself must reach `OIDC_ISSUER` over HTTPS (discovery, token and UserInfo requests); if the provider's hostname only resolves on the host, for example through Tailscale MagicDNS, map it with `extra_hosts` in the compose file. On a fresh registry, sign in first as a member of `ADMIN_GROUP`: admins get their account and world automatically and then approve everyone else at `/admin`.

### HTTPS and reverse proxy

`docker compose --profile https up -d` starts Caddy, which needs `TOUCHLINE_DOMAIN` resolving to your public IP and ports 80 and 443 forwarded to the Pi. Without port forwarding, keep the app on `127.0.0.1:3001` and publish it with a tunnel (for example Cloudflare Tunnel or Tailscale Funnel) or your own proxy; set `APP_ORIGIN` to the public HTTPS origin and `TRUST_PROXY` to the number of proxies in front of the app. Sign-in needs HTTPS. Never publish PostgreSQL.

### Sign-in and access

Touchline signs players in with OpenID Connect (Authorization Code with PKCE) against `OIDC_ISSUER` and reads `sub`, `preferred_username`, `name`, `email` and `groups` from the ID token and the UserInfo endpoint. Any standards-compliant provider works; the steps below use [Authelia](https://www.authelia.com) 4.39 with its file user backend. Touchline needs no `forward_auth` in the reverse proxy: it handles sign-in itself.

1. Generate the client secret and its hash: `authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986` (or `docker run --rm authelia/authelia:4.39 authelia crypto hash generate …`). Put the random password in Touchline's `.env` as `OIDC_CLIENT_SECRET` and the digest in Authelia's configuration.
2. Add a client and a claims policy to Authelia's `configuration.yml` (the OIDC provider itself, `hmac_secret` and `jwks`, must already be set up), then restart Authelia:

```yaml
identity_providers:
  oidc:
    claims_policies:
      touchline:
        # Authelia 4.39 keeps ID tokens minimal; Touchline also reads these from UserInfo.
        id_token: ['groups', 'email', 'email_verified', 'name', 'preferred_username']
    clients:
      - client_id: 'touchline'
        client_name: 'Touchline'
        client_secret: '$pbkdf2-sha512$310000$…'   # the digest from step 1
        public: false
        authorization_policy: 'two_factor'
        consent_mode: 'implicit'
        require_pkce: true
        pkce_challenge_method: 'S256'
        redirect_uris:
          - 'https://touchline.example.com/auth/callback'
        scopes: ['openid', 'profile', 'email', 'groups']
        response_types: ['code']
        grant_types: ['authorization_code']
        token_endpoint_auth_method: 'client_secret_basic'
        userinfo_signed_response_alg: 'none'
        claims_policy: 'touchline'
```

3. In Touchline's `.env`: `OIDC_ISSUER=https://auth.example.com` (Authelia's public URL, exactly as its discovery document reports it), `OIDC_CLIENT_ID=touchline`, `OIDC_CLIENT_SECRET`, and `OIDC_LOGOUT_URL=https://auth.example.com/logout` (Authelia 4.39 advertises no `end_session_endpoint`, so sign-out continues there).
4. Put yourself in the Authelia group named by `ADMIN_GROUP` (default `admins`) in `users_database.yml`.

Adding a player:

1. Create their Authelia user in `users_database.yml` (password hash from `authelia crypto hash generate argon2`); they set up two-factor authentication on first use.
2. They open Touchline and sign in once. Touchline records a pending access request and shows them a *Waiting for approval* screen.
3. An admin opens `/admin` (also linked from **Settings**) and approves the request. Approval creates the player's private, empty world; the player selects *Check again* and starts a career.

`/admin` lists capacity, pending and denied requests, and current players. A denied request can be approved later. There is no revocation in the app: to remove a player, disable or delete their Authelia user (an existing Touchline session stays valid until it expires after `SESSION_TTL_HOURS`). Admins get their account automatically on first sign-in and do not count towards `MAX_PLAYERS`, which caps approved non-admin players (`0` allows admins only). To start a player over, `npm run career:delete -- --username NAME` (dry run; `--apply --yes` deletes) removes their active career but keeps the account.

| Variable | Purpose |
| --- | --- |
| `REQUIRE_AUTH` | `true` on any hosted install; local development runs without sign-in |
| `APP_ORIGIN` | Exact public HTTPS origin, for example `https://touchline.example.com` |
| `OIDC_ISSUER` | Issuer URL of the OpenID Connect provider (required with `REQUIRE_AUTH=true`) |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | The confidential client registered at the provider (`client_secret_basic`) |
| `OIDC_LOGOUT_URL` | Optional sign-out page when the provider has no `end_session_endpoint`; otherwise sign-out ends at `/auth/signed-out` |
| `SESSION_SECRET` | Signs the session cookie, at least 32 characters (`openssl rand -base64 48`) |
| `SESSION_TTL_HOURS` | Session lifetime in hours, default 8 |
| `TRUST_PROXY` | Number of reverse proxies in front of the app (1 for Caddy) |
| `ADMIN_GROUP` | Provider group whose members are admins, default `admins` |
| `MAX_PLAYERS` | Cap on approved non-admin players, enforced on approval (default 10; `0` = admins only) |
| `DB_SIZE_LIMIT_GB` | Database-size guard enforced on approval (default 24) |

### Backups and restore

`npm run pi:backup` (or `bash scripts/pi-backup.sh` on a host without Node) writes an online `pg_dump` custom-format file of the whole database (every world, save and the account registry) plus the cluster roles to `backups/`, verifies that it reads back and deletes backups older than `BACKUP_RETENTION_DAYS` (14). Schedule it daily and copy `backups/` off the Pi:

```sh
15 4 * * * cd /opt/touchline && bash scripts/pi-backup.sh >> backups/backup.log 2>&1
```

To restore, `bash scripts/pi-restore.sh backups/touchline-<stamp>.dump --yes` stops the app, takes a safety backup, recreates the database owned by `SQL_USER`, restores the dump and starts the app again. On a new Pi, start `postgres` with the same `.env` first so the app role exists. `npm run data:export -- --everything --out-dir DIR` remains available as a portable, engine-independent backup.

### Upgrading

```sh
bash scripts/pi-backup.sh
git pull                                   # compose file, scripts and docs
docker compose pull app                    # or: docker compose build app
docker compose run --rm app npm run db:migrate -- --registered               # review (fine with no players yet)
docker compose run --rm app npm run db:migrate -- --registered --apply --yes
docker compose --profile https up -d --wait
```

Pin a digest (`TOUCHLINE_IMAGE=ghcr.io/carlossardo/touchline@sha256:…`, printed by the image workflow) for reproducible upgrades and rollbacks; roll back the database with `pi-restore.sh`, not by running an older image against migrated data. For a PostgreSQL major upgrade, back up, remove the `postgres-data` volume, change the image tag and restore.

### Moving careers from the old Azure version

The Azure SQL deployment is retired, and its database cannot be attached to PostgreSQL. Careers move as portable saves:

1. While the old site still runs, each player opens **Settings > Saves** and exports a `.touchline.gz` save (the operator can also run `npm run data:export -- --out FILE` per world from a checkout of the last Azure release).
2. On the Pi, the player signs in (an admin, or once approved), starts any career, then imports the file in **Settings > Saves**. The import runs in a single transaction and replaces that world; worlds before version 4 cannot be imported.

Keep the exported files until every player has confirmed their career on the Pi.

### Performance on the Pi

- Use an SSD (USB 3) rather than an SD card, active cooling to avoid throttling, and the 64-bit OS. PostgreSQL is tuned for that; adjust the `-c` flags in `compose.yaml` on a different machine.
- Simulation runs in the app process: full-world days and generating a new full world take noticeably longer than on a desktop (minutes for a new career). A smaller world (`db:seed -- --nations ...`) is faster.
- The app's heap is capped at 1.5 GB (`TOUCHLINE_NODE_OPTIONS`) within a 2 GB container limit; raise both together if a large world needs more.
- `log_min_duration_statement=2s` logs slow queries (`docker compose logs postgres`); `npm run db:footprint` reports per-table sizes.

## Saves and legacy careers

- Careers save to PostgreSQL as you play. **Settings > Saves** manages snapshot slots and `.touchline.gz` imports/exports; imports run in a single transaction.
- Restore and import replace the active world, so make a named save first.
- Deploying does not upgrade a career. Worlds before version 4 cannot be imported; start a new career instead.
- The one-time SQLite import tool was retired with SQL Server: convert a SQLite-era career with an earlier release and export it as `.touchline.gz`. Keep the originals offline.

## Game rules

Touchline aims to be believable, not a certified replica of football regulations. World rules live in [shared/world-rules.ts](shared/world-rules.ts), valuations and finance in [shared/rules.ts](shared/rules.ts) and [server/finance.ts](server/finance.ts), and implemented features versus gaps in [REQUIREMENTS.md](REQUIREMENTS.md).

References: [FIFA RSTP (Jan 2025)](https://digitalhub.fifa.com/m/696d877ea35ca761/original/Regulations-on-the-Status-and-Transfer-of-Players-January-2025-edition.pdf), [FA minor clearance](https://playerstatus.thefa.com/support/solutions/articles/80001135173-what-is-international-clearance-itc-including-minor-applications), [FA GBE criteria 2026/27](https://www.thefa.com/-/media/files/thefaportal/governance-docs/registrations/gbe-2026-27/fa-mens-players-gbe-criteria-202627.ashx), [UEFA format](https://www.uefa.com/uefachampionsleague/news/0268-12157d69ce2d-9f011c70f6fa-1000--new-format-for-champions-league-post-2024-everything-you-ne/), IFAB laws on [players](https://www.theifab.com/laws/latest/the-players/) and [duration](https://www.theifab.com/laws/latest/the-duration-of-the-match/), and the [Premier League Handbook 2026/27](https://resources.premierleague.pulselive.com/premierleague/document/2026/07/31/8a890ff9-176c-4364-a8ff-e08f995e2c86/TM2040_PL-Handbook-and-Collateral-2026-27_Digital_31.07.pdf).

## Project layout

| Path                 | Contents                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| [src/](src/)         | React screens, components and canvas pitch maps                          |
| [server/](server/)   | Express API, SQL store, world generation, match engines, saves, accounts |
| [shared/](shared/)   | Types, API contracts, rules and formulas shared by client and server     |
| [scripts/](scripts/) | Migration, seeding, import/export, verification, backup and restore      |
| [e2e/](e2e/)         | Playwright browser tests                                                 |
| [deploy/](deploy/)   | PostgreSQL initialization, Caddy HTTPS proxy and the test database stack |

Built with React 19, TypeScript, Vite, Express, PostgreSQL 18 (node-postgres), openid-client, Zod, Recharts and Lucide icons.

## Credits and data sources

- Names use [Faker](https://github.com/faker-js/faker) locale data (MIT) and [cities.json](https://github.com/lutangar/cities.json) 1.1.61, derived from [GeoNames](https://www.geonames.org/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Club names are fictional and imply no endorsement.
- Result calibration uses CC0 [OpenFootball](https://github.com/openfootball/football.json/tree/40b3e1b7391932d133287115106304444bf297e1) Premier League 2023/24 and 2024/25 aggregates; details in [server/check-simulation.ts](server/check-simulation.ts).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report bugs and ideas in [GitHub Issues](https://github.com/CarlosSardo/touchline/issues).

## License

Copyright (c) 2026 Carlos Sardo. Released under the [MIT License](LICENSE). Third-party packages and bundled fonts keep their own licenses.
