# Touchline

A local-first football sporting director simulation. Every new career starts on **1 July 2026**. You run the sporting project; the manager selects the team and plays the matches.

[Development status](REQUIREMENTS.md) | [Contributing](CONTRIBUTING.md) | [MIT License](LICENSE)

## Run Locally

Requires Node.js **22.13 or newer** and npm. Node 22 prints an experimental warning for its built-in SQLite driver; this is expected.

The tested Node version is pinned in [.nvmrc](.nvmrc). After cloning, `nvm use` selects it when nvm is installed.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The SQLite API listens on `127.0.0.1:3001`. Both are bound to loopback. No cloud account, remote database, telemetry, externally hosted fonts or runtime API is used. The first launch generates the world locally.

For the production build:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. `npm start` serves the built UI and local API together. `npm run preview` is only Vite's static preview and does not start the game engine.

Optional environment variables:

| Variable   | Default              | Purpose                  |
| ---------- | -------------------- | ------------------------ |
| `GAME_DB`  | `data/career.sqlite` | Active SQLite career     |
| `SAVE_DIR` | `data/saves`         | Local snapshot directory |
| `API_PORT` | `3001`               | Loopback API port        |
| `UI_PORT`  | `5173`               | Vite UI port             |

Example for occupied ports: `API_PORT=3011 UI_PORT=5181 npm run dev`.

## The World

The initial world contains **243 country/territory football associations**, **1,215 domestic leagues**, **6,040 clubs**, **120,000 senior players**, **40,000 youth players**, and **48,376 staff**. Another **15,000 academy players** are generated at each annual season rollover. Retired players remain in SQLite as career records; active database searches exclude them.

Every association has three senior tiers plus U17 and U19 leagues. Additional tables, fixtures and draws cover national cups, youth cups and super cups, continental tournaments, international youth championships, and the named youth invitationals in the blueprint. Spain, Portugal, Germany and the Netherlands have B teams; England, Italy and Belgium do not.

Names, clubs, attributes, histories and results are procedural, not a licensed real-world dataset. The country/territory catalog is broader than FIFA membership. A new active database takes roughly 0.4 GB before match history and snapshots. Storage grows as matches and seasons are recorded.

## Playing

- Open the club badge to choose your director background and appointment before advancing the first day. The default appointment is Northbridge Athletic.
- Use the player database to combine identity, position, age, ability, potential, attribute, personality, lifestyle, contract, financial and performance filters. All searches and pagination run against SQLite.
- Assign scouts, inspect uncertain reports, shortlist players, make enquiries and negotiate club and agent terms. Medicals and registration occur as time advances.
- Set squad roles, agree development plans, pair mentors, recruit staff, invest in facilities and answer the board and press. Decisions update finances, trust, morale, expectations and development inputs.
- Use the loan desk for nine loan types, detailed guarantees, partnerships, success/pressure reports, recalls and purchase clauses. The negotiation sheet contains the salary-split slider and all agreement terms.
- Advance one, seven, fourteen or twenty-eight days. There is no match-control interface. Completed matches have reproducible event logs, ratings, xG/xA, xPts and eight interactive pitch maps.

The settings screen includes interface, simulation, difficulty, accessibility, gameplay, director, save and experimental preferences. Simulation speed sets the default advance interval. Match detail changes the action-log density without changing results. Cloud sync is deliberately locked off to honor the local-only requirement.

## Saves

The active career is written to SQLite transactionally. Settings > Saves creates local snapshot slots, restores them, and imports/exports SQLite or gzip-compressed saves. Autosaves are created at the selected cadence, including during multi-day advances; the latest three automatic snapshots are retained. No files are uploaded.

Restoring or importing replaces the active career. Make a named save before loading another one. To start another independent world, launch with a different `GAME_DB` path. Databases, save slots, test artifacts and dependencies are excluded from Git.

## Verification

```sh
npm test
npm run lint
npm run build
npm run world:check
npx playwright install chromium
npm run test:e2e
```

`world:check` verifies the initial population, B-team rules, foreign-key reachability, SQLite integrity and indexed prospect search. It expects an initial world before annual intake, and uses `GAME_DB` when provided.

Browser tests start their own local API/UI on ports 3002/5180 and use `data/e2e.sqlite`, not the normal career. A baseline snapshot makes repeated runs reproducible. The suite checks all screens, typed player search, filters, player dossiers, desktop/mobile overflow, settings, scouting, complete transfers, outgoing loan/recall, full-world advancement, and nonblank/distinct pixels for every pitch map. It also rejects external runtime requests. `TEST_URL` can target an already-running **test** career, but the suite refuses to mutate a normal career database.

## Implementation

| Area                                           | Location               |
| ---------------------------------------------- | ---------------------- |
| SQLite schema and transactions                 | `server/db.ts`         |
| Deterministic world and player generation      | `server/world.ts`      |
| Competition formats, schedules and progression | `server/calendar.ts`   |
| Event-level match engine and xPts              | `server/match.ts`      |
| Daily/weekly simulation and season rollover    | `server/simulation.ts` |
| Scouting, deals, loans, staff and consequences | `server/systems.ts`    |
| Filtered read models and screen queries        | `server/queries.ts`    |
| Validated local HTTP actions                   | `server/app.ts`        |
| SQLite snapshots and compression               | `server/saves.ts`      |
| Shared player model, formulas and settings     | `shared/`              |
| React screens and canvas pitch analysis        | `src/`                 |

Uses React 19, TypeScript, Vite, Express, Node SQLite, Zod, seedrandom, roundrobin, simple-statistics, Recharts and Lucide. Match snapshots include an engine version so earlier event streams remain reproducible when the current rules evolve.

## Scope And Limits

This is a playable implementation spanning the requested systems, **not a claim of commercial football-simulation fidelity or literal completion of every realism requirement**. See [REQUIREMENTS.md](REQUIREMENTS.md) for implementation coverage and known gaps.

Important limitations include generalized continental allocation and knockout rules, no exhaustive association-specific registration/FFP regulations, a custom seeded match model rather than SofaScore-calibrated data, rule-based social/media events, and no long-duration multi-season balance validation at full world scale. Long simulation steps can take tens of seconds because the entire world is simulated on the local server. The browser remains responsive with a progress state, but another action waits for simulation to complete.

Apple SF Symbols are not bundled: the cross-platform browser UI uses Lucide icons. Player graphics are faceless silhouettes and custom pitch/crest artwork. Haptic feedback uses the browser vibration API only when available. Weather follows seeded climate/season heuristics, not a meteorological service. Cloud synchronization is intentionally absent.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request guidance. CI runs lint, unit/integration tests and the production build on pushes to `main` and pull requests. Report bugs and feature requests in [GitHub Issues](https://github.com/CarlosSardo/sports-director-simulator/issues).

## License

Copyright (c) 2026 Carlos Sardo. Released under the [MIT License](LICENSE). Third-party packages and bundled fonts retain their respective licenses; the MIT grant covers this project's original code and assets.
