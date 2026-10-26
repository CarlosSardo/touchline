<div align="center">

# ⚽ Touchline

**A football sporting-director simulation, self-hosted on a Raspberry Pi**

[![Verify](https://github.com/CarlosSardo/touchline/actions/workflows/verify.yml/badge.svg)](https://github.com/CarlosSardo/touchline/actions/workflows/verify.yml)
[![CD](https://github.com/CarlosSardo/touchline/actions/workflows/cd.yml/badge.svg)](https://github.com/CarlosSardo/touchline/actions/workflows/cd.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)

[![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](.nvmrc)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
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
- **Internationals:** Senior, U21, U20, U19 and U17 national teams, UEFA youth qualifying and the main youth tournaments, senior international friendlies in the FIFA windows; caps on player dossiers and a club policy for releasing players outside FIFA windows.
- **Call-ups:** temporary moves between the club's own teams (next match, a number of days, until a date), coach call-ups or proposals, a debut budget per season and up to three development requests.
- **Scouting and transfers:** uncertain scout reports, shortlists and multi-stage deals with instalments, buy-back, sell-on, seller loan-back and pre-contract options; release clauses (on every Spanish contract) and part-exchange deals; rival bids, best-and-final rounds, future arrivals and affiliate placements; transfer history per player and per club, kept apart from squad movements; see [Release clauses and swap deals](#release-clauses-and-swap-deals).
- **Club offers for your players:** other clubs make transfer and loan offers based on their own squad needs, level, budget and wage room. **Settings › Simulation › Transfer/Loan Offer Frequency** (Low / Medium / High, default Medium) sets how busy that market is; see [How the transfer market works](#how-the-transfer-market-works).
- **A world transfer market:** other clubs buy, sell and loan players among themselves every day, based on their squad needs, budgets, wage room and FFP headroom: development loans, selling to buy, free agents between windows and a deadline-day rush. FFP stops any AI signing that would breach the rules, and clubs that break them get settlements, levies, points deductions or registration embargoes; see [World market and FFP](#world-market-and-ffp).
- **Loans and youth recruitment:** nine loan types. Loans out are club-initiated: clubs send loan offers (dates, fee, wage split, role and playing time, recall, option or obligation, sell-on, reason) that you accept, reject or counter, and you choose who is on your loan list. Loans in, recalls, purchase clauses, affiliate development loans and modelled FIFA rules for minors remain.
- **Signing separate from registration:** a signing is stopped only by real transfer rules. Association registration (work permission), competition registration (foreign quotas) and match eligibility are decided afterwards and shown as statuses such as *Signed · eligible*, *Signed · not registered* or *Ineligible · insufficient GBE (9/15)*; see [Registration and eligibility](#registration-and-eligibility).
- **GBE:** FA 2026/27 points model with a per-criterion breakdown on the player sheet. The points come from simulated international caps, club minutes, results and league standard, and are recalculated as the career goes on. Missing data counts as *no data*, not as zero. See [GBE](#gbe).
- **Squad and academy:** first team, reserve club, U19 and U17 groups, development plans, mentors and squad roles.
- **A living club:** staff, facilities, board and press decisions, an affiliate network and unexpected events.
- **Clubs that act on their own:** AI clubs form and end affiliate partnerships, invest in training facilities, academies and stadiums, appoint directors of football with a transfer policy, change formation with a new manager and can go into administration; relegation wage-cut clauses apply when a club goes down. A *World football* feed reports it all; see [Club life](#club-life).
- **Owners and takeovers:** every club has an owner (a local business owner, a billionaire, a state-backed fund, a private equity fund or its members), and eight fictional multi-club groups own clubs in several countries. Clubs are bought and sold over time, member clubs elect presidents, Germany's 50+1 rule and UEFA's multi-club rule apply, and your own club can be taken over; see [Owners and takeovers](#owners-and-takeovers).
- **Player pages:** six tabs (Overview, Career, Attributes & development, Scouting, Contract & registration, Medical); transfers and loans listed apart from squad movements and call-ups; season statistics grouped by season, club and competition; honours, injury history and career milestones; see [Player pages](#player-pages).
- **Competition pages:** standings, fixtures and results, qualification and history for every league, cup, continental and international competition, plus a top-scorer race with the Golden Boot leader, players level on goals sharing a rank, goals for several clubs after a transfer added up, and earlier seasons.
- **Match analysis:** reproducible simulation with ratings, xG, xA, xPts and interactive pitch maps.
- **Robust simulation:** every simulated day commits on its own, so a failure part-way through *Continue* keeps the days already played and reports where it stopped.
- **Media and supporters:** fictional journalists, a news feed and supporter reactions.
- **Saves and settings:** PostgreSQL persistence, autosaves, portable `.touchline.gz` exports, colour modes, themes and eight display currencies.

All names, clubs, attributes and results are procedurally generated, not licensed real-world records.

## Quick start

You need **Node.js 24.11 or newer** (see [.nvmrc](.nvmrc)), npm and Docker (or an existing PostgreSQL 18).

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
| `npm run simulation:check`          | Compare a 600-match sample with real aggregates (`-- --seasons=3` soak; the soak fails if the world outgrows its storage budget) |
| `npm run image:build`               | Build the Docker image for this machine's architecture (`touchline:local`) |
| `npm run ci`                        | Run the CI pipeline exactly as GitHub Actions does (Dagger; needs only Docker), see [CI](#ci-dagger) |
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

`npm run verify` runs lint, the production build, SQL-backed unit/integration/save tests and the Playwright suite; `--parallel` runs them as concurrent jobs in per-job databases and writes logs to `reports/`. Tests use the real schema in isolated `touchline_test_` / `touchline_e2e_` schemas and must never target a player's world. Remote-database rules and guards are in [CONTRIBUTING.md](CONTRIBUTING.md).

### CI (Dagger)

CI is a [Dagger](https://docs.dagger.io) pipeline, the TypeScript module [.dagger/modules/touchline-ci](.dagger/modules/touchline-ci/src/index.ts), and [scripts/ci.sh](scripts/ci.sh) is its only entrypoint: the GitHub Actions workflows [verify.yml](.github/workflows/verify.yml) (CI: pull requests, pushes to `main`, manual dispatch) and [cd.yml](.github/workflows/cd.yml) (CD, see [Continuous deployment](#continuous-deployment)) run exactly the commands below. It needs only Docker: the script installs the pinned, checksum-verified Dagger CLI (into `~/.cache/touchline/dagger`) and runs a local Dagger engine container. Dagger Cloud is not used (no token, no cloud engine, telemetry off).

```sh
npm run ci                                   # all suites: static, then backend, world and e2e in parallel
npm run ci -- backend,e2e                    # selected suites: static, backend, world, e2e
npm run ci -- backend --shard=2/3            # one shard, exactly as a GitHub Actions matrix job runs it
npm run ci -- world --seasons=5 --full-world # longer season soak, also on the full world
npm run ci -- image                          # build the linux/amd64 + linux/arm64 release image, no push
npm run ci -- timings                        # rebalance shards from the last run's timings (scripts/ci/test-timings.json)
npm run ci -- dagger check -l                # the pinned Dagger CLI; `dagger check` runs the suites as checks
```

Each suite runs in containers against its own throwaway PostgreSQL 18 service: `static` (lint, build and the SQL-free unit tests, in parallel), `backend` (the SQL integration and save tests in 3 shards, each with its own PostgreSQL; together with `static` exactly the files `npm test` runs), `world` (catalog test, `world:check`, a 3-season `simulation:check`, `db:footprint` and the backup / world reset smoke) and `e2e` (Playwright on the official Playwright image, in 2 spec-file shards with their own database and servers). Shards are balanced by the per-file durations in `scripts/ci/test-timings.json`; locally all shards run at once, in GitHub Actions each is a matrix job. Every step runs even when an earlier one fails; logs, reports and per-step exit codes are exported to `ci-logs/<suite>/` (uploaded as workflow artifacts), and the script exits non-zero if any step failed. Tests see the same loopback `SQL_*` environment as `npm run test:local`. The Dagger version is pinned in `scripts/ci.sh`; after changing the module run `npm run ci -- dagger generate -y` and commit the generated files.

### Continuous deployment

Every merge to `main` goes to the Raspberry Pi on its own, with no stored secret and no inbound access to the Pi:

1. **CI** ([verify.yml](.github/workflows/verify.yml)) runs on the push. If the exact git tree already passed every job on its pull request (a squash merge of an up-to-date PR), it reuses that result ([scripts/ci/verified.sh](scripts/ci/verified.sh)); otherwise every suite runs.
2. **CD** ([cd.yml](.github/workflows/cd.yml), runs titled *Release: \<commit\>*) starts when CI succeeds for that push and runs one release at a time. It releases the newest commit on `main` whose push passed CI, recomputed at each step: a newer commit that fails CI doesn't hold back the last good one, and a dropped or late CD run can't roll anything back. Don't use `[skip ci]` on `main`: such a commit is never verified, so it only ships with the next verified commit.
3. **Publish**, on GitHub's runners: `scripts/ci.sh publish` builds, pushes and verifies `ghcr.io/carlossardo/touchline:sha-<commit>` and `:latest` for linux/amd64 and linux/arm64.
4. **Deploy**, on the Pi itself (GitHub environment `production`, limited to `main`): its self-hosted runner picks up the job and runs [scripts/ci/cd.sh](scripts/ci/cd.sh) `deploy`, which never moves the Pi to an older commit, runs [scripts/deploy.sh](scripts/deploy.sh) `local` (the Pi pulls with the job's short-lived `GITHUB_TOKEN` through a temporary Docker config, then migrates and restarts), and checks that the app container runs the released commit and that `/api/health` answers.

The release checks retry transient GitHub API errors; the deploy itself runs once (one deploy at a time on the host). A failed pull or revision check leaves the running app untouched; a failed migration or start may leave the database migrated, so recover from a database backup ([Backups](#backups-and-restore)), not an older image. Re-running CD repeats the deploy. `scripts/ci/cd.sh candidate` and `scripts/ci/cd.sh deploy <sha>` run the same steps by hand.

**The runner** is GitHub's Actions runner in `~/actions-runner` on the Pi, registered to this repository with the label `touchline-deploy` (only CD's deploy job uses it). It only makes outbound HTTPS connections to GitHub, updates itself, and runs as the deploy user in the systemd user service `actions-runner.service`, with lingering on so it starts at boot without a login (no sudo). Install it, or register it again after rebuilding the host, from a checkout with `gh` logged in as a repository admin:

```sh
scripts/ci/install-runner.sh carlos@raspberrypi   # idempotent; checksum-verified download
ssh carlos@raspberrypi systemctl --user status actions-runner      # journalctl --user -u actions-runner for logs
```

Workflows of this repository can run code on the Pi as that user (who is in the `docker` group), so keep the repository private and only target `touchline-deploy` from CD.

## Hosting on a Raspberry Pi

The production stack in [compose.yaml](compose.yaml) runs on a Raspberry Pi 4 Model B (8 GB) with an SSD and 64-bit Raspberry Pi OS, or on any arm64/amd64 Linux host with Docker:

- `postgres`: the official `postgres:18` image, data in the `postgres-data` volume, published only on `127.0.0.1:5432`, tuned for 8 GB RAM and an SSD (`shared_buffers=1GB`, `effective_cache_size=4GB`, `random_page_cost=1.1`, `jit=off`, compressed WAL, 15-minute checkpoints). On first start [deploy/postgres/initdb](deploy/postgres/initdb/10-touchline-role.sh) creates `SQL_USER` as a non-superuser owner of `SQL_DATABASE`; the `postgres` superuser is only for administration and backups.
- `app`: the multi-arch image `ghcr.io/carlossardo/touchline` built by [cd.yml](.github/workflows/cd.yml) for every verified commit on `main` (or built locally from the [Dockerfile](Dockerfile)), React UI and Express API on `127.0.0.1:3001`, 2 GB memory limit.
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

#### Deploying from a checkout

[scripts/deploy.sh](scripts/deploy.sh) deploys a commit to this setup: it streams the commit as a tarball over SSH, and the host pulls the image CI built for that commit, `ghcr.io/carlossardo/touchline:sha-<commit>`, and runs it with this compose file. Commits on `main` deploy automatically through this script ([Continuous deployment](#continuous-deployment)).

To deploy by hand, run the script from a checkout. With `--build` the host builds the image from the tarball instead (~4 minutes on a Pi 4), for example for a commit that is not on `main`:

```sh
scripts/deploy.sh carlos@raspberrypi          # HEAD; or: scripts/deploy.sh <ssh-host> <git-ref>
scripts/deploy.sh --build carlos@raspberrypi  # build on the host instead of pulling
scripts/deploy.sh local                       # on the host itself, without SSH (used by the CD runner)
```

The package is private. For manual pulls, log the host in to GHCR once, as the user that runs the deploys, with a classic personal access token that has only `read:packages` ([create one](https://github.com/settings/tokens/new?scopes=read:packages&description=touchline-pull)): `docker login ghcr.io -u <github-user>` and paste the token. For a one-off without a stored login, set `GHCR_TOKEN` (a token with `read:packages`) and `GHCR_USER` (its GitHub user): the script hands it to the host over SSH standard input, never on a command line, and the host deletes it before pulling and drops the temporary login right after. The `sha-<commit>` image exists only for commits on `main`; until CD has published it, or for any other commit, the pull fails with a hint and changes nothing, so wait or use `--build`.

On the host, in `~/touchline` (`TOUCHLINE_DIR` to change it), the commit is unpacked into a fresh staging directory and [deploy/host-deploy.sh](deploy/host-deploy.sh) from it runs one deploy at a time: it holds `.deploy.lock` (`flock`, from util-linux) for the whole run, so a manual deploy and a CD deploy never overlap; a second one waits up to 15 minutes, then gives up without changing anything. It pulls the image, refuses it unless its `org.opencontainers.image.revision` label is the deployed commit, prints its digest and tags it `local/touchline:<commit>` and `:latest` (with `--build` it builds those tags with `docker buildx`, labelled with the full commit). It then moves the source to `src/`, installs [deploy/compose.external-postgres.yaml](deploy/compose.external-postgres.yaml) as `compose.yaml`, creates or checks the account registry, migrates the registered worlds, starts the app and checks `/api/health`. It keeps the three newest images. The running container keeps the image's revision label, so `docker inspect touchline` shows the deployed commit. The host needs Docker (with buildx for `--build`), `curl`, `flock`, and a `.env` in that directory before the first deploy, with the database settings, the sign-in settings and `TOUCHLINE_PORT`. The script adds `TOUCHLINE_IMAGE=local/touchline:latest` and `TOUCHLINE_PULL_POLICY=never`, so `docker compose pull` (for example a weekly image update) skips the app and only a deploy changes it. A failed pull, check or build leaves the running container untouched. Nothing is retried, and a failed migration or start can leave the database already migrated: roll back with a database backup, not an older image.

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

World migrations 2–11 apply to existing careers through the same `db:migrate -- --registered` step; no new world is needed:

| Migration | Adds |
| --------- | ---- |
| 2–5 | Narrow player rows, the GBE evidence tables, player and competition registrations, an index for club offers |
| 6 | `sanctions` (FFP and solvency sanctions); drops two indexes the old market used |
| 7 | `club_projects` (infrastructure projects) and an index for the World football feed |
| 8 | `owners`, `club_ownership` and `ownership_events` |
| 9 | `player_honours`, `player_injuries` and `player_milestones` |
| 10 | An index for the competitions' top-scorer races |
| 11 | Indexed `players.height` and `players.weight` columns for the player database filters |

Migration 2 rewrites each world's `players` table once and is exempt from the statement timeout, so on a full-sized world it takes longer than the others. Migrations 6–10 only create tables and indexes; their contents are filled in on the next day played or save load (see [Saves](#saves-and-legacy-careers)). Migration 11 copies every player's height and weight from the profile once (about 10 s on a full-sized world on a development machine).

### Moving careers from the old Azure version

The Azure SQL deployment is retired, and its database cannot be attached to PostgreSQL. Careers move as portable saves:

1. While the old site still runs, each player opens **Settings > Saves** and exports a `.touchline.gz` save (the operator can also run `npm run data:export -- --out FILE` per world from a checkout of the last Azure release).
2. On the Pi, the player signs in (an admin, or once approved), starts any career, then imports the file in **Settings > Saves**. The import runs in a single transaction and replaces that world; worlds before version 4 cannot be imported.

Keep the exported files until every player has confirmed their career on the Pi.

### Performance on the Pi

- Use an SSD (USB 3) rather than an SD card, active cooling to avoid throttling, and the 64-bit OS. PostgreSQL is tuned for that; adjust the `-c` flags in `compose.yaml` on a different machine.
- Simulation runs in the app process: full-world days and generating a new full world take noticeably longer than on a desktop (minutes for a new career). A smaller world (`db:seed -- --nations ...`) is faster.
- *Continue* commits each simulated day, and its autosave, separately instead of holding one transaction for the whole week or month. Old row versions can be cleaned up between days, and if a later day fails the days already played are kept: the request still succeeds and shows the error. Only a failure on the first day returns an error status. Failures are logged with the operation, route, SQL error code and stack (`docker compose logs app`). Other actions still wait until the request finishes.
- Player rows are rewritten after every match day, so the `players` table is tuned for frequent updates (migration 2): the large profile column is stored out of line, pages are kept half empty (`fillfactor = 50`) so most updates stay on their page (HOT), autovacuum runs earlier, and the search index no longer covers player value. The simulation also vacuums `players` itself every week, after busy match days and at the season rollover. In a development measurement on a 6,400-player world, the `players` table measured 669 MB after 120 simulated days with the old 7-days-per-transaction advance, compared with 32 MB now. Pi timings have not been measured yet.
- Weekly club finances are one set-based statement, cup-round fixtures are prepared in batches, and club friendlies skip the per-match squad queries.
- The world market, club life, ownership and player records run as bounded set-based passes (daily or weekly) over one shared daily snapshot of every club. In a development measurement on an x86 desktop, not a Pi (full world, 67 simulated days from 1 July through the summer window), AI clubs completed 12,269 transfers and loans where the old market made 816, and a simulated day took 6.6 s on average instead of 10.4 s. Recording honours, injuries and milestones added about 0.6% per simulated day on the full world. Pi timings for these changes have not been recorded yet.
- The app's heap is capped at 1.5 GB (`TOUCHLINE_NODE_OPTIONS`) within a 2 GB container limit; raise both together if a large world needs more.
- `log_min_duration_statement=2s` logs slow queries (`docker compose logs postgres`); `npm run db:footprint` reports per-table sizes. The `simulation:check` soak fails when the `players` table exceeds 10 KB per player or the other tables grow faster in a season than the budget for the fixtures played. A one-season soak passed with +24.4 MB against its 32 MB budget. The GBE evidence tables added 3.7 MB per season on that soak world and about 27 MB after a season on a 60,000-player world. The first season after generation may grow up to 1.75 times the budget, because it also fills rolling tables (monthly minutes, next season's fixtures, registrations) to their steady size. In development three-season soaks with the world market, club life, ownership and player records (England + Spain, and England + Spain + Germany), every season stayed within its budget: +60.5 MB and +69.1 MB in the first season (budgets 67 and 77 MB), then +25.5 to +38.4 MB against 38–44 MB, with `players` at 5.4–6.1 KB per row.

## Saves and legacy careers

- Careers save to PostgreSQL as you play. **Settings > Saves** manages snapshot slots and `.touchline.gz` imports/exports; imports run in a single transaction.
- Restore and import replace the active world, so make a named save first.
- Deploying does not upgrade a career. Worlds before version 4 cannot be imported; start a new career instead.
- Careers and `.touchline.gz` saves made before the registration, GBE and offer-frequency changes still load. Their missing registration and GBE tables are restored empty: existing players keep their registrations, foreign-quota lists are rebuilt on the next day played, and GBE evidence is rebuilt once (a pre-career estimate plus the months already played). **Transfer/Loan Offer Frequency** starts at Medium.
- Careers and saves made before the living-world changes (migrations 6–9) also load, and the new tables are filled in once on the next day played or save load: every club gets an owner from the world seed (the same owners a new world with that seed would get), Spanish contracts get their release clauses, directors of football and relegation clauses are added as the club-life passes run, and honours (from recorded champions), milestones (from finished seasons' statistics and this season's appearances) and current injuries are backfilled. Injuries before the upgrade are not reconstructed, and there are no sanctions or infrastructure projects until the game decides some.
- The one-time SQLite import tool was retired with SQL Server: convert a SQLite-era career with an earlier release and export it as `.touchline.gz`. Keep the originals offline.

## Game rules

Touchline aims to be believable, not a certified replica of football regulations. World rules live in [shared/world-rules.ts](shared/world-rules.ts), valuations and finance in [shared/rules.ts](shared/rules.ts) and [server/finance.ts](server/finance.ts), registration and eligibility in [server/eligibility.ts](server/eligibility.ts) and [shared/eligibility.ts](shared/eligibility.ts), GBE rules in [shared/gbe/](shared/gbe/), club offers in [server/market-offers.ts](server/market-offers.ts), the world market in [server/world-market.ts](server/world-market.ts), sanctions in [server/sanctions.ts](server/sanctions.ts), club life in [server/club-life.ts](server/club-life.ts) and the modules it calls, ownership in [server/ownership.ts](server/ownership.ts), and implemented features versus gaps in [REQUIREMENTS.md](REQUIREMENTS.md).

References: [FIFA RSTP (Jan 2025)](https://digitalhub.fifa.com/m/696d877ea35ca761/original/Regulations-on-the-Status-and-Transfer-of-Players-January-2025-edition.pdf), [FA minor clearance](https://playerstatus.thefa.com/support/solutions/articles/80001135173-what-is-international-clearance-itc-including-minor-applications), [FA GBE criteria 2026/27](https://www.thefa.com/-/media/files/thefaportal/governance-docs/registrations/gbe-2026-27/fa-mens-players-gbe-criteria-202627.ashx), [UEFA format](https://www.uefa.com/uefachampionsleague/news/0268-12157d69ce2d-9f011c70f6fa-1000--new-format-for-champions-league-post-2024-everything-you-ne/), IFAB laws on [players](https://www.theifab.com/laws/latest/the-players/) and [duration](https://www.theifab.com/laws/latest/the-duration-of-the-match/), and the [Premier League Handbook 2026/27](https://resources.premierleague.pulselive.com/premierleague/document/2026/07/31/8a890ff9-176c-4364-a8ff-e08f995e2c86/TM2040_PL-Handbook-and-Collateral-2026-27_Digital_31.07.pdf).

### How the transfer market works

Registration windows run from 15 June to 1 September and from 1 January to early February. Every day, each other club looks at its own squad depth by position, its level, its transfer budget and its wage room, including money and wages already committed to other deals. It approaches you only when it needs a player like yours and can afford him, and his personal terms are checked before the offer is sent. Injured players, players out on loan and players already in talks are not approached. Offers mostly concern players on your transfer or loan list, surplus players and young or unregistered players a club needs. On Medium and High, a club occasionally bids above value for an unlisted key player.

- **Offer frequency** (*Settings › Simulation › Transfer/Loan Offer Frequency*, saved with the career): Low aims at about 2 relevant offers per open-window week, Medium about 5 and High about 9. These are targets, not quotas: a club needs a real reason to make an offer, so you get fewer when few of your players suit other clubs. In development runs, the averages per window week were 2.2 (Low), 5.4–5.6 (Medium) and 9.4 (High), about 40% transfers and 60% loans.
- **Timing:** offers stop 7 days before deadline day, so an accepted deal still registers in the window. In the 10 days before a window opens, clubs make offers that take effect on its opening day. Between windows there are only domestic emergency loans from clubs with three or more unavailable senior players.
- **Limits:** a club does not come back for the same player within 42 days, and each player and each club can have only a few open offers at once. Accepting an offer withdraws the others for that player. Clubs also withdraw an offer if the player gets injured, their budget no longer covers it, or they sign someone else for that position.
- **Loan offers** (*Loans › Loan offers*) state the club, start and end dates, loan fee, wage split, role and expected playing time, recall clauses, any option or obligation to buy (with its conditions) or sell-on share, the club's reason and a reply-by date. You accept, reject or counter. A loan starts on the agreed date and appears in the *Loan tracker* with weekly monitoring. At the end date it becomes permanent if an obligation's condition is met or the borrower takes up its option; otherwise the player returns. Recalls follow the agreed clauses. Because offers are checked before they are sent, every accepted offer completed in development runs; before this change, many accepted loans failed at a later rule check.
- **Loan list:** there is no "find a club" search for your own players. Use *Loans › Loan list* to make a player available, and to see how many open offers he has. Loans in are still arranged from the player database.

### World market and FFP

Other clubs also deal with each other every day. Once a day the game takes a snapshot of every club: squad depth by position and age, transfer budget, wage room (counting wages that leave before the window closes), FFP headroom, any embargo, its director of football's policy and its owner. Clubs short in a position buy or borrow; clubs with surplus, unhappy or expiring players sell or lend them.

- **Moves:** transfers, loans and development loans (young players lent to get minutes; the parent club pays more of the wage when the borrower cannot). A club with money coming in may sign first and sell later in the same window. Most moves happen in the windows, with a rush on deadline day, when clubs still over budget end surplus contracts by mutual consent (with a severance payment) and loan players out to cut wages. Between windows, clubs short in a position look for free agents on two days a week. Sister clubs of the same owner group deal with each other more often.
- **Budgets and contracts:** boards review AI wage budgets every week as targets limited by FFP headroom, cash and the owner's ambition, and cap them at a sustainable level at the season rollover. AI clubs renew expiring contracts on terms they can afford (the going rate, adjusted for role, minutes and age); some players refuse and leave as free agents. Your own renewals work as before.
- **FFP gate:** with **FFP enforcement** on (*Settings*, Difficulty; on by default), no AI club buys or borrows a player whose added squad cost would breach its limits. This applies to the world market, approaches for your players, rival bids and the completion of every deal.
- **Sanctions:** after the accounts close each season, clubs that broke the rules are punished, harder if they broke the same rule the season before:
  - UEFA squad-cost ratio over 70%: a settlement agreement (a fine now, the same again if the club misses next season's target), plus a one-season registration embargo when more than 10 points over or repeated.
  - Premier League squad-cost ratio over 85%: a levy, plus 6 points deducted when more than 15 points over (10 from 30 points over, 4 more if repeated).
  - Football losses beyond UEFA's acceptable deviation: a settlement agreement, plus an embargo when the loss is more than twice the deviation or repeated.
  - A missed settlement target: the conditional amount is charged and the club gets a one-season embargo.
  - Every week, a club whose cash is more than four weeks of its wage budget below zero cannot register new signings until the balance is positive again.

  Points deductions count in the club's league table and show in the standings. Your club's squad-cost headroom and sanctions are in *Finances › Financial regulations*; every sanction appears in the *World football* feed. With FFP enforcement off, there is no FFP gate and no sanctions.

In development three-season runs (England + Spain, and England + Spain + Germany), top-flight clubs averaged 6.6–8.7 incoming senior moves per season (transfers, loans and free signings), second tiers 5.9–7.6, and the lowest tier of each pyramid 3.1–4.4. Loans were 25–41% of moves, free signings about 12% from the second season on, and deadline day 3–6%. Volumes were lowest in the third season, below the calibration target for the top flight; see the known gaps in [REQUIREMENTS.md](REQUIREMENTS.md).

### Release clauses and swap deals

- **Release clauses:** every professional contract at a Spanish club has one, as Spanish law requires (5–8 times his value for a prospect, 2.5–4.5 times for an established player and 1.5–2.5 times for a veteran). Elsewhere about 12% of contracts include one (1.5–3 times his value). The clause is shown under the player's contract. A buyer that pays it cannot be refused by the club, but the player still has to agree personal terms. In club talks for a player with a clause, **Pay release clause** skips the fee negotiation and moves straight to personal terms. In the personal terms of your own signings you can set a release clause (0 means none, or the league default in Spain). AI clubs pay release clauses too, including for your players, at most once every 60 days at your club.
- **Swap and player-plus-cash deals:** in club talks for a permanent transfer, **Include a player (part-exchange)** adds one of your first-team players to the cash fee. The selling club values him by his market value, how much it needs his position and how well he fits its level, and counts that towards your offer. He must be an adult, not in other talks, willing to join and affordable on the seller's wage budget, and the deal fails if he is no longer available when it completes. AI clubs make part-exchange deals among themselves too.

### Registration and eligibility

Being signed and being allowed to play are separate:

1. **Contract (signing).** Only real transfer rules can stop a signing: the registration window, the transfer and wage budgets (or a transfer embargo), FIFA Article 19 for minors, loan rules and a valid contract. A GBE or a foreign-player quota never does.
2. **Association registration.** In this model only English clubs need work permission. British and Irish nationals, and players moving between English clubs with an existing registration, need no Governing Body Endorsement (GBE); everyone else needs enough GBE points. If a player does not have enough points, registration is refused, and if no GBE evidence exists yet it is pending. In both cases the case is reviewed again after 28 days. An approved registration lasts for the whole spell at the club.
3. **Competition registration.** Domestic senior league and cup squads count the association's foreign-player quota. Continental competitions need only the association registration. When a quota place frees up during a window, the next player on the list is registered.
4. **Match eligibility.** Competitive matches need both registrations and a player who is not injured or suspended. Friendlies and training need only a contract. The manager never picks an ineligible player for a competitive match.

Registrations are reviewed again after each GBE refresh, when a window opens, every 28 days for open cases, when a quota place frees up, at the season rollover, and when a loan starts, ends or is recalled. Squad lists, the player database and *Boardroom › Squad registration* show badges such as *Signed · eligible*, *Signed · not registered*, *Registration pending*, *Ineligible · insufficient GBE (x/15)*, *Eligible after requirements (date)* and *On loan · eligible*. The player sheet's *Registration & eligibility* section shows the contract, the association and competition registrations with their reasons, whether he can play the next match, and the GBE breakdown. For players at other clubs it shows *Registration if signed*. A signed but unregistered player can still train and play friendlies, and clubs may offer to take him on loan so he can earn GBE points. Real UK immigration rules would stop such a signing altogether; letting it go ahead is a deliberate simplification.

#### GBE

GBE: FA 2026/27 points model with a per-criterion breakdown on the player sheet. Six criteria score points: senior international appearances, domestic minutes, continental minutes, league position, continental progression and league standard. Club minutes count over the last 12 months, and senior international appearances and Elite Significant Contribution over the last 24 months (12 months for youth internationals). A player needs 15 points. With 10–14 points he is in the Exceptions Panel band, which the game does not grant automatically, and a high enough international record is an automatic pass. British and Irish nationals are exempt. Each criterion shows as *scored*, *zero* (data exists but earns no points), *no data* (missing evidence is not counted as zero) or *pre-game estimate* (for careers that started before the match was simulated). The overall result is automatic pass, pass, Exceptions Panel band, fail, exempt or no data.

Every senior match feeds a monthly minutes record. The points are recalculated weekly whenever a new month starts, for every player at the season rollover, for squad players after each senior international window, and on request when a player's result is out of date (he changed club, it is more than 38 days old, or the ruleset changed). Older careers and saves build this record on the next day played or when the save loads. The breakdown appears in the player sheet's *Registration & eligibility* section and in the *Registration if signed* preview, and the API serves it at `GET /api/players/:id/gbe`.

Senior national teams play an *International Friendlies* competition in the March and June FIFA windows; nations outside their confederation's Nations Series also play on its autumn dates, about ten matches a year in total. Friendlies count as international appearances only for nations that played fewer than 30% competitive matches, as in the FA rules.

In a development run of 12 nations (about 22,500 senior club players), 8% of players had zero points in a fresh world and 7% after a season; before this model nearly everyone had zero. Capped internationals averaged about 34 points and 95% passed, against about 7 points and a 16–18% pass rate for uncapped players. After a season, players in the strongest league band averaged 21.1 points (63% of non-exempt players passing), falling through 16.2 (55%), 12.0 (38%), 7.7 (2%) and 5.1 (0%) to 2.4 (0%) in the weakest band.

### Club life

Other clubs run themselves. *Media › World football* reports what they do (transfers, loans, contracts, affiliates, infrastructure, directors of football, managers, ownership, sanctions and administration), with filters by kind, association, club and text; these items stay out of your inbox. A club's page shows its projects, director of football and any administration.

- **Affiliates:** a club with fewer partners than it wants (one to three, by reputation) looks for one under the same consent and fee rules as yours, at home or, for strong top-flight clubs, in a country with a heritage link. Once a year each agreement is reviewed: its strength follows the loans made through it, and weak, idle, unaffordable or outgrown agreements end, as do those between clubs now in the same division. In the windows, clubs lend young players (17–21) they cannot give first-team football to their affiliates; cross-border loans are for adults only and never go into England, Scotland, Wales or Northern Ireland, where a work permit would be needed.
- **Infrastructure:** clubs below the training facilities or academy of their peers (same country and tier) upgrade them; clubs near their stadium capacity expand it, and big clubs far behind their peers build a new stadium (planning, then two to three seasons of building, about 70% borrowed). Weekly payments count as excluded investment under FFP. Finished projects raise facilities, academy or capacity, and with them revenue, development and youth intake. Your board decides your own club's projects and lists them in the boardroom; the facility and academy investments you approve under *Finances › Infrastructure* work as before.
- **Directors of football:** AI clubs in the top three tiers, or with a reputation of 50 or more, employ a director of football. His transfer policy (balanced, youth first, value for money or star signings) follows his style, the owner's ambition, the club's finances and philosophy and, at member clubs, the president's election promise. It shapes the club's targets in the market and holds for at least 91 days. A director can be dismissed in a deep crisis once he has been in post for a year.
- **Managers and formations:** the chance that a board sacks its manager rises each week with the sporting crisis and lost trust; a new manager has 70 days' grace and brings his own formation and style (4-3-3, 4-2-3-1, 3-5-2 or 4-4-2, weighted by the country's football culture and the tier), which selection and the club's transfer needs then follow.
- **Administration:** a club whose cash, less the transfer instalments due in the next 91 days, stays more than 40% of a season's revenue (at least £250k) below zero for ten weekly checks enters administration, unless a wealthy, patient owner rescues it (at most once a year). The club loses points (England 12, 10 below the fourth tier; Scotland 15; Germany 9; Spain none; elsewhere 10; next season's table if its league has finished), gets a registration embargo, must sell its highest earners, halts its projects and is put up for sale. It leaves administration once its cash recovers after at least 12 weeks, or through a creditors' agreement after 26 weeks. If it is your club, a notice in the office and the boardroom list the board-imposed sales, and you cannot take those players off the transfer list.
- **Relegation wage-cut clauses:** a contract with one cuts the wage by 25–50% if the club is relegated. About 80% of contracts in tiers 2–4 carry one and about 45% at amateur level; in the top flight it depends on the club's reputation, from none at established clubs to most contracts at the smallest. The cut applies at the season rollover, lowers the player's morale and is reported in the news; the clause is shown under the player's contract.

### Owners and takeovers

Every club has an owner, generated from the world seed: a **local business owner**, a **billionaire investor**, a **state-backed fund**, a **private equity fund** or its **members**. Clubs in Germany (the 50+1 rule; up to two works teams are exempt), Sweden, Norway and Argentina, the top two Spanish and top three Portuguese clubs are member-owned; English and Italian clubs are (almost) all privately owned. A stake of 40% or more gives control. Eight fictional multi-club groups (among them a state-backed network, an energy-drink group and a US private equity firm) own clubs in several countries. The *Ownership* tab on a club's page and the owners and groups list in *World* show who owns what.

- **Owner types:** state owners and ambitious billionaires put new equity into their clubs each season; this counts as owner equity under FFP, not revenue. Private equity funds charge interest on the debt they place on the club and a management fee; asset strippers take dividends and cut budgets. When you ask the board for funds, a wealthy, ambitious billionaire or state owner may add equity once a season.
- **Takeovers:** a sale goes from rumour to bid to completion over several weeks, and some collapse along the way. Groups buy clubs abroad as feeders, supporters' trusts can take over struggling lower-tier clubs, and at 50+1 clubs an outsider can only buy a minority stake, paid in as new capital. Clubs of the same group prefer each other for loans and transfers.
- **Elections:** member clubs elect a president every two to four years (four in Spain, Portugal and Germany, three in Brazil and Turkey, two in Sweden and Norway). Candidates campaign on promises, and members can force an early election when results and the mood collapse.
- **UEFA multi-club rule:** two clubs controlled by the same owner cannot play in the same UEFA competition. If the owner places one of them in a blind trust before 1 March, both may play, but they cannot deal with each other; otherwise the lower-placed club is excluded and the next eligible club takes its place.
- **Related-party deals:** a transfer between clubs of the same owner counts in the FFP accounts at fair value: the agreed fee if it is within 15% of the player's market value, otherwise his market value.
- **If your club is taken over:** the board news and an office notice follow every stage. The new owners set a new target finish and budget and review your work after 120 days: if board confidence is then below their target (35–60, depending on their ambition), they appoint their own sporting director and your career at the club ends (your record stays, and you can take a role at another club from the career settings). You are reminded 30 days before the review. A new president at a member-owned club starts the same review.

In a two-season development run, 38 takeovers and 13 acquisitions by multi-club groups completed, 73 elections took place and 4 clubs were placed in a blind trust: about 4.4% of clubs changed hands per year, about 8% in top flights.

### Player pages

The player sheet has six tabs: **Overview**, **Career** (transfers and loans, squad movements, season statistics, honours, milestones and caps), **Attributes & development**, **Scouting**, **Contract & registration** (the contract with any release or relegation clause, registration and eligibility, GBE) and **Medical** (wellbeing and injury history). Each section appears once.

- **Transfers and squad movements:** *Transfers & loans* lists only moves between different clubs, including loans and their ends. Moves inside the club family (B team, U19, U17) and call-ups are listed separately under *Squad movements*; a call-up and its return are one entry with its length. Club *Transfers* tabs no longer count call-ups or family moves; they show them in a collapsible *Squad movements* block.
- **Season statistics** are grouped by season, then club, then competition, with subtotals and a career total, and can be filtered by competition and club. Appearances, minutes, goals and assists cover every competitive match of every season, on the full engine or the fast model (league, cups, continental and international matches; a loanee under the club he played for; national-team matches under the national team). Average ratings come from the match records, which are kept for the current season and for your club's matches; seasons without them show *—*. Friendlies are listed separately (current season and your club's matches) and never count in the totals. A substitute sent on in stoppage time is credited one minute; goals lost that way in older worlds and saves are restored once from the fixtures' goal lists on the next advance.
- **Honours:** league, cup, continental and international (senior and youth) titles for players who appeared for the winner, marked *Regular*, *Squad* or *Limited role* by their share of the matches. League titles are recorded at the season rollover, cups and tournaments on the day they are decided. There are no individual awards, because the game does not compute any.
- **Injury history:** every injury from full matches, quick-simulated matches and weekly training, with diagnosis, severity, expected return and rehab updates (`GET /api/players/:id/medical`).
- **Milestones:** debuts (senior, club and international), first goals, and appearances, goals and caps at 50, 100 and further steps. Whole-career milestones are kept only for players who were under 20 when the world began and had no pre-game senior minutes, because older players' earlier careers are not known.

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
