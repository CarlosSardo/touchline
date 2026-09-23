# Project Context

- **Owner:** Carlos Sardo
- **Project:** Touchline, a realism-focused football sporting-director simulation game
- **Stack:** TypeScript, Node.js, Express, SQL Server/Azure SQL, Vitest, Docker
- **Created:** 2026-09-22

## Core Context

Data owns SQL schema and queries, saves and snapshots, account mapping, authorization boundaries, per-user isolation, and migration safety. Important surfaces include `server/db.ts`, `server/sql-schema.ts`, `server/saves.ts`, `server/accounts.ts`, and migration scripts.

## Learnings

- Mutable world state and saved careers belong to one verified Entra identity and must never leak across users.
- Existing careers and snapshots require preservation checks before and after every schema migration.

📌 Team update (2026-09-23T09:15:46+0200): Focused account-release verification gate for the per-user isolation release is now in decisions.md — known checkpoint busy-response race must be fixed and pass before production; full 38-scenario browser suite is not certified (initial run 7 passed, 1 failed, 30 unrun) — decided by Squad Coordinator

### 2026-09-23T09:41:05+0200 — New-career 409 root cause (read-only analysis)
- `POST /api/careers/prepare` runs `generateWorld(store, { seed })` inside one HTTP request and one SQL transaction. With no seniors/youth passed, `buildWorldStructure` defaults to the EXPANDED world (~834k players, ~11.9k clubs), not the 160k legacy size. Tests only exercised a mocked 2-country fixture.
- The per-schema `busy` flag returns 409 for every same-account request (including `/api/me` and `/api/bootstrap`) for the whole mutation, and the handler keeps running after the client or ingress disconnects. PR #2's client turns a 409 during `loadSession` (focus/visibility/reload) into a full account reset and the "Reconnect to account" panel.
- Preparation is atomic (single transaction, exclusive per-schema applock, emptiness/state rechecked inside the transaction), so it cannot leave a partial world or run twice. A killed replica, ETIMEDOUT or quota error still means a full rollback. `POST /api/careers` is NOT idempotent: retrying after an unacknowledged success archives the new career and regenerates a whole world.
- Every `read` takes the exclusive world applock plus a connection from a 4-connection pool shared by all accounts and the registry. A long prepare pins one connection and shares 2 vCores, 32 GB and free vCore-seconds (AutoPause) with the live dbo career.

### 2026-09-23T11:49:00+0200 — Busy contract + delete-career (server half, uncommitted on squad/new-career-busy-delete)
- Implemented `world_busy` 409 (code/operation/startedAt + `Retry-After: 2`), ungated `/api/me` with `activity`, `DELETE /api/careers/active` (careerId+seed confirmation, TRUNCATE/range-delete `discardWorld`), classic (non-expanded) prepare, and `scripts/career-delete.ts` (dry-run default, `--apply --yes`, refuses dbo). 119/119 local SQL tests, lint (only pre-existing warnings) and build green.
- Real-size LOCAL timings (160k players, laptop SSD): prepare 54.6 s, Start career 178.5 s (snapshot 61.9 MB / 62 chunks). Azure serverless 2 vCores will likely exceed the 240 s ingress cut for Start career — the client must poll `/api/me`, never retry the POST.
- Learning: my measurement scripts create a separate `touchline_measure_<hex>` DATABASE (not a schema in touchline_checks); an interrupted run leaves it behind. Always list exact names first, then drop with a strict regex guard; `timeout` + pipefail + tee + 15 s heartbeats kept the rerun bounded.

📌 Team update (2026-09-23T13:56:00+0200): New-career busy fix + Delete career shipped via PR #3 (e80e867) — classic world (`expanded:false`) for new private careers, delete-active refuses dbo (409 career_protected, revised by Product after Lead REJECT); next: delete Carlos's last-created career via career:delete (dry-run first, SQL_REQUEST_TIMEOUT_MS=900000) — decided by Lead, Carlos Sardo
