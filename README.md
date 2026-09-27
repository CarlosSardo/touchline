# Touchline

Touchline is a football sporting-director simulation. You take charge of a club's long-term project on **1 July 2026**: recruitment, contracts, squad planning, the academy, staff, facilities and finances. The manager picks the team and plays the matches; your job is to give them the right players and keep the club healthy for years to come.

- Play the hosted game: [Open Touchline](https://touchline.thankfulgrass-3ef59c98.swedencentral.azurecontainerapps.io/) is invite-based. [Request an invite](https://touchline.thankfulgrass-3ef59c98.swedencentral.azurecontainerapps.io/invite), then sign in with a personal Microsoft account (Outlook.com, Hotmail, Live.com, MSN or any email registered as a Microsoft account). Work/school, Google and Apple sign-in are not supported.
- Current status and known gaps: [REQUIREMENTS.md](REQUIREMENTS.md)
- How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md)

## Features

- **A large procedural world:** 211 football associations, 107 of them with their own league pyramid of one to six tiers (England six), B teams, U19/U17 leagues, national cups and continental competitions.
- **Internationals:** Senior, U21, U20, U19 and U17 national teams, UEFA youth qualifying and the main youth tournaments; caps on player dossiers and a club policy for releasing players outside FIFA windows.
- **Call-ups:** temporary moves between the club's own teams (next match, a number of days, until a date), coach call-ups or proposals, a debut budget per season and up to three development requests.
- **Scouting and transfers:** uncertain scout reports, shortlists and multi-stage deals with instalments, buy-back and sell-on clauses; rival bids and best-and-final rounds; transfer history per player and per club.
- **Loans and youth recruitment:** nine loan types, recalls and purchase clauses, and modelled FIFA rules for minors.
- **Squad and academy:** first team, reserve club, U19 and U17 groups, development plans, mentors and squad roles.
- **A living club:** staff, facilities, board and press decisions, an affiliate network and unexpected events.
- **Match analysis:** reproducible simulation with ratings, xG, xA, xPts and interactive pitch maps.
- **Media and supporters:** fictional journalists, a news feed and supporter reactions.
- **Saves and settings:** SQL persistence, autosaves, portable `.touchline.gz` exports, colour modes, themes and eight display currencies.

All names, clubs, attributes and results are procedurally generated, not licensed real-world records.

## Quick start

You need **Node.js 22.13 or newer** (see [.nvmrc](.nvmrc)), npm and Docker.

```sh
npm ci
cp .env.example .env        # then set a strong SQL_PASSWORD; never commit .env
docker compose up -d --wait # SQL Server 2022 Developer on 127.0.0.1:1433
docker compose exec sql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -C -Q "CREATE DATABASE touchline"
set -a; . ./.env; set +a    # load .env without printing it
npm run db:migrate          # review the plan, then:
npm run db:migrate -- --apply --yes
npm run db:seed -- --seed touchline-2026 --apply --yes # new, empty database only; add --nations PT,IE for a small world
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173); the API runs on `127.0.0.1:3001`.

- Startup never migrates the schema or generates a world. Never reseed to repair an existing career.
- Local development runs without sign-in, so it does not exercise Entra authentication or per-account isolation.
- All settings are environment variables, listed with local defaults in [.env.example](.env.example).

## Commands

| Command                             | What it does                                                            |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                       | UI (5173) and API (3001) with live reload                               |
| `npm run build` then `npm start`    | Build and serve the production UI and API together on port 3001         |
| `npm run lint` / `npm run format`   | Lint with oxlint / format with Prettier                                 |
| `npm run db:migrate`                | Show pending schema migrations; add `-- --apply --yes` to apply         |
| `npm run db:seed -- ...`            | Generate a world in a new, empty database                               |
| `npm run data:export -- --out FILE` | Export the active world to a portable `.touchline.gz` file              |
| `npm run data:export -- --everything --out-dir DIR` | Back up the registry, every world and snapshot with `manifest.json`; `--verify DIR` checks it offline |
| `npm run world:reset -- --all`      | Dry run of emptying every world and snapshot; `--apply --yes` performs it (keeps accounts and migrations) |
| `npm run db:footprint`              | Read-only per-table size report; flags worlds over 1.6 GB                |
| `npm run world:check`               | Generate the world in a test schema and check its invariants; prints one JSON line, exits 1 on a violation (`-- --nations=EN,ES`) |
| `npm run simulation:check`          | Compare a 600-match sample with real aggregates (`-- --seasons=3` soak) |

If ports are taken: `API_PORT=3011 UI_PORT=5181 npm run dev`. `npm run preview` serves only the static build, not the game engine.

## Testing

`npm run test:local` starts a disposable SQL Server on `127.0.0.1:14330` (credentials in the ignored `.env.test.local`, no Azure) and runs `npm test`, or any command after `--`:

```sh
npx playwright install chromium   # once, for browser tests
npm run test:local -- npm run verify
npm run test:local -- npm run verify -- --parallel
```

`npm run verify` runs lint, the production build, SQL-backed unit/integration/save tests and the Playwright suite. Tests use the real SQL schema in isolated `touchline_test_` / `touchline_e2e_` schemas and must never target a player's world. Remote-database rules and guards are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Hosting and deployment

The hosted game is one Azure Container App (Consumption, 0 to 1 replicas) serving the React UI and Express API behind EasyAuth, plus one Azure SQL Free database. EasyAuth uses the `https://login.microsoftonline.com/common/v2.0` issuer, and the app registration accepts personal Microsoft accounts. Images are built with the [Dockerfile](Dockerfile), pushed to private GHCR and deployed from the workstation; there is no CI pipeline.

Access is invite-based:

1. A player requests an invite at [`/invite`](https://touchline.thankfulgrass-3ef59c98.swedencentral.azurecontainerapps.io/invite).
2. The approver gets an email and reviews the request at `/admin/invites` while signed in.
3. Accepting sends the player an email. Denying is silent.
4. On first sign-in with the accepted personal Microsoft account, an owner-executed stored procedure creates that player's private world schema. The runtime still has no `CREATE SCHEMA` permission.

The owner/legacy world rebind happens automatically on first personal-account sign-in as `sardo.kiko@gmail.com` or `carlos.sardo@outlook.com`. The app keeps the free-tier guardrails: `MAX_PLAYERS=10` and `INVITE_DB_SIZE_LIMIT_GB=24` for the Azure SQL Free 32 GB database.

Email uses Gmail SMTP with a Google app password. If hosted `SMTP_PASSWORD` is unset, deployment uses `EMAIL_TRANSPORT=disabled`: invite requests still appear in `/admin/invites`, and emails can be resent after SMTP is configured. Local development uses the `log` transport and prints invite links to the API console.

Operator setup:

```sh
npm run azure:auth -- --yes --allow-personal-accounts
# Set SMTP_PASSWORD in .env from Google Account > Security > 2-Step Verification > App passwords.
npm run azure:deploy -- --yes
```

Invite settings:

| Variable | Purpose |
| --- | --- |
| `APPROVER_EMAIL` | Address that receives request review emails and may approve when signed in |
| `OWNER_EMAIL` | Personal Microsoft account email treated as the owner |
| `MAX_PLAYERS` | Player cap, excluding the owner |
| `INVITE_DB_SIZE_LIMIT_GB` | Database-size guard before accepting or claiming invites |
| `INVITE_SIGNING_SECRET` | HMAC secret for signed review/resend links |
| `EMAIL_TRANSPORT` | `gmail`, `disabled` when hosted; `log` for local development |
| `SMTP_USER` | Gmail SMTP account |
| `SMTP_PASSWORD` | Google app password for Gmail SMTP |
| `SMTP_FROM` | Optional From header, defaulting to `Touchline <SMTP_USER>` |

Cost: the invite/auth/email setup uses free services only (Gmail SMTP, personal Microsoft account sign-in, Container Apps consumption grant and Azure SQL Free).

Operator commands (each documents itself with `--help`): `azure:provision`, `azure:auth`, `azure:sql`, `azure:deploy`, `azure:rollback`, `accounts:migrate` and `career:delete`. See [scripts/azure-deploy.sh](scripts/azure-deploy.sh), [scripts/azure-provision.sh](scripts/azure-provision.sh) and [scripts/azure-rollback.sh](scripts/azure-rollback.sh).

Release safety rules (full rules in [CONTRIBUTING.md](CONTRIBUTING.md)):

- Keep secrets only in the ignored `.env`, never in commands, images, logs or chat.
- The automatic pre-deploy export covers only the `dbo` world; back up other accounts and the registry separately.
- Deployment never provisions accounts or seeds careers. Rollback and `--image` releases fail closed once the registry exists; ship a reviewed forward fix instead.
- Promote a `--hold-ingress` candidate only through the reviewed manual procedure, never by rerunning deploy, rollback or `--image`. It is in `git show 1acda49:README.md`.
- SQL Free auto-pauses when its monthly allowance runs out. Do not add keep-alive probes or billable extras.

## Saves and legacy careers

- Careers save to SQL as you play. **Settings > Saves** manages snapshot slots and `.touchline.gz` imports/exports; imports run in a single transaction.
- Restore and import replace the active world, so make a named save first.
- Deploying does not upgrade a career. Worlds before version 4 cannot be imported; start a new career instead.
- Old SQLite careers can be imported once with `npm run data:migrate`; keep the originals offline. Options are in [scripts/data-migrate.ts](scripts/data-migrate.ts).

## Game rules

Touchline aims to be believable, not a certified replica of football regulations. World rules live in [shared/world-rules.ts](shared/world-rules.ts), valuations and finance in [shared/rules.ts](shared/rules.ts) and [server/finance.ts](server/finance.ts), and implemented features versus gaps in [REQUIREMENTS.md](REQUIREMENTS.md).

References: [FIFA RSTP (Jan 2025)](https://digitalhub.fifa.com/m/696d877ea35ca761/original/Regulations-on-the-Status-and-Transfer-of-Players-January-2025-edition.pdf), [FA minor clearance](https://playerstatus.thefa.com/support/solutions/articles/80001135173-what-is-international-clearance-itc-including-minor-applications), [FA GBE criteria 2026/27](https://www.thefa.com/-/media/files/thefaportal/governance-docs/registrations/gbe-2026-27/fa-mens-players-gbe-criteria-202627.ashx), [UEFA format](https://www.uefa.com/uefachampionsleague/news/0268-12157d69ce2d-9f011c70f6fa-1000--new-format-for-champions-league-post-2024-everything-you-ne/), IFAB laws on [players](https://www.theifab.com/laws/latest/the-players/) and [duration](https://www.theifab.com/laws/latest/the-duration-of-the-match/), and the [Premier League Handbook 2026/27](https://resources.premierleague.pulselive.com/premierleague/document/2026/07/31/8a890ff9-176c-4364-a8ff-e08f995e2c86/TM2040_PL-Handbook-and-Collateral-2026-27_Digital_31.07.pdf).

## Project layout

| Path                 | Contents                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| [src/](src/)         | React screens, components and canvas pitch maps                          |
| [server/](server/)   | Express API, SQL store, world generation, match engines, saves, accounts |
| [shared/](shared/)   | Types, API contracts, rules and formulas shared by client and server     |
| [scripts/](scripts/) | Migration, seeding, import/export, verification and Azure tooling        |
| [e2e/](e2e/)         | Playwright browser tests                                                 |

Built with React 19, TypeScript, Vite, Express, mssql, Azure Identity, Zod, Recharts and Lucide icons.

## Credits and data sources

- Names use [Faker](https://github.com/faker-js/faker) locale data (MIT) and [cities.json](https://github.com/lutangar/cities.json) 1.1.61, derived from [GeoNames](https://www.geonames.org/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Club names are fictional and imply no endorsement.
- Result calibration uses CC0 [OpenFootball](https://github.com/openfootball/football.json/tree/40b3e1b7391932d133287115106304444bf297e1) Premier League 2023/24 and 2024/25 aggregates; details in [server/check-simulation.ts](server/check-simulation.ts).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and report bugs and ideas in [GitHub Issues](https://github.com/CarlosSardo/touchline/issues).

## License

Copyright (c) 2026 Carlos Sardo. Released under the [MIT License](LICENSE). Third-party packages and bundled fonts keep their own licenses.
