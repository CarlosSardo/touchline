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

### 2026-09-26T18:50:00+0200 — Loading performance + player history API (branch squad/world-rebuild-2, uncommitted)
- Loading bottlenecks (code evidence, no live timings): every `read()` took the EXCLUSIVE world applock, so reads serialized against each other; pool `idleTimeoutMillis` 10 s + tedious 20 building a NEW `DefaultAzureCredential` per connection login (connection.js ~2496) = TLS + login + uncached Entra token after every 10 s pause; `/api/bootstrap` counted players in 3 separate scans; load career = full "before load" archive + chunk download + validate pass + restore pass (clear + bulk insert) in one transaction.
- Implemented: `Store.readTransaction()` (sp_getapplock `Shared`; run/exec/bulkInsert/all-with-writes throw inside; `locked=false` so clearWorld refuses) and app.ts `pureRead` on audited write-free routes only (health/details, bootstrap, players, players/:id/career, players/:id/history, world/clubs, world/audit, GET saves); pool idle 60 s; bootstrap totals in one pass. Proposed only: shared token credential (`token-credential`), validate-while-downloading, skip unchanged-world archive on load, players-search covering index (hurts simulation writes).
- Player history: `history` rows `transfer`/`loan`/`squad` + `loans` table; loan ends now stamp `loans.data.endedOn` (no schema change). Full-engine appearances are identified by `JSON_VALUE(stats,'$.passes') IS NOT NULL` (fast-model rows store `{}` or only STAT_KEYS, even for followed loanees) — NOT by club family, because `state.clubId` changes after game over. Fast-model rows still carry simulated goals/assists/rating columns.
- `player_season_stats` (competitive only, keyed by state.season) survives retention; `player_match_appearances` adds friendlies but non-user rows are pruned at season end — merge per season×club×competition with max(), never sum.
- db.test.ts fake-driver groups run without SQL: `npx vitest run server/db.test.ts -t "no database"`.

### 2026-09-26T19:00:00+0200 — All reads on the SHARED world lock (branch squad/world-rebuild-2, uncommitted)
- app.ts now has ONE `read` wrapper = `store.readTransaction` (sp_getapplock Shared, READ COMMITTED, 30 s, transaction-owned); the exclusive `read`/`pureRead` split is gone. Audit: every GET handler (queries.ts, media/notifications/events feeds, club-support desks, assessPlayerInterest, saves.list) and every helper they call is write-free; writers found only in systems/finance/club-support/events action paths. A future write in a read handler throws "A read-only SQL transaction cannot write." (500) — app.test would catch it.
- Consistency: batched() holder keeps Exclusive for the whole callback, so a Shared reader cannot see its autocommitted partial statements. Only lock-free plain get/all outside a transaction (/api/me) can. Reads never upgrade (writes throw), so no S->X conversion deadlocks; the lock queue is FIFO so a waiting writer blocks later readers (no writer starvation).
- bootstrap world totals cached per Store, keyed by careerId|seed|date|max(players.id)|max(staff.id) (two PK seeks) instead of counting ~834k players on every loadSession. squad()/clubDetail() filter on persisted `playing_club_id` (index player_playing_squad) instead of `coalesce(squad_club_id,club_id)`.
- NOT added: negotiations/loans club indexes (those tables only hold user-club deals + incoming offers; AI market writes `history`), news unread filtered index (row count unknown). Any index = migration 7, which needs db:migrate on every world before saves work (checkpointSchema demands the exact migration set) and collides with Lead's planned migration 7 `world_jobs`.
- Verification: server tsc, lint, 77 non-SQL db tests green. Docker socket permission denied + 14330 closed, so SQL tests (incl. new "runs world readers side by side, while plain and batched writers exclude them", opt-in SQL_INTEGRATION_TESTS=true) and app.test were NOT run.
- Shared terminal swallows short sync commands; write a /tmp script and `setsid bash` it, then read the log.

### 2026-09-26T19:30:00+02:00 — Club transfers API (branch squad/world-rebuild-2, uncommitted)
- `GET /api/clubs/:id/transfers` in server/club-transfers.ts, types `ClubTransfers`/`ClubTransfer`/`ClubTransferSeason`/`ClubTransferTotals`/`ClubTransferClub` in shared/api.ts; kinds reuse `PlayerMoveKind`, helpers (`parse`, `idOrNull`, `transferKind`…) now exported from player-history.ts.
- Every completed move lands in `history` with `data.from/to` (or `fromClubId/toClubId` for `squad`): systems.ts completion (user deals, `loan`/`transfer`), transfer-battles.ts `executeMarketTransfer` (AI market), youth.ts `registerFreeAgent` + rollover "Squad registration" bulk insert. Loan ends only in `loans` (user deals). Releases at contract expiry and retirements write NO history row.
- history has no club key, so a club view is a filtered backward PK scan; cached per Store+club keyed by careerId|seed|max(history.id) so paging/filters don't rescan. Real fix = indexed computed from/to columns in a future migration (reported, not added).
- JSON_VALUE returns nvarchar: compare with a string parameter (`String(clubId)`) instead of TRY_CONVERT per row.
- FOR JSON drops NULL keys (youth.ts registration rows omit `from`), so readers must treat a missing key as null.

### 2026-09-26T20:30:00+02:00 — Player Database search performance + rival fog wiring (branch squad/world-rebuild-2, uncommitted)
- Root cause: every `/api/players` did count(*) + `players.*` sort/OFFSET, both clustered scans of ~834k rows whose `profile` NVARCHAR(max) sits in-row (KBs/row); the always-sent default predicates (form/goals/minutes >= 0, wage <= 1e9) referenced clustered-only columns, so even the unfiltered page could not use any nonclustered index. Nationality filter ran OPENJSON on every profile.
- Fix pattern: ids first, display rows last. Write the id query as self-joins on `players.id`, one alias per covering NC index (`players`=player_filter, `squad`=player_market_squad, `named`=player_name, `nation`=player_nationality); any clustered-only column collapses to one alias. `compileSearch` probes clauses once to learn the columns, then renders. Sort keys must be lazy thunks or every sort's columns get recorded.
- Top N Sort only streams for N <= 100; a TOP (10001) ranking would be a full sort, so counting is `count(*) FROM (TOP 10001 …)` without ORDER BY and pages keep OFFSET/FETCH.
- The driver binds every string as nvarchar(max) and every non-int number as float: CAST string params to the column type and send integer bounds for int columns.
- In-process search caches are safe only because all world writes go through app.ts `mutation` and the app runs 0..1 replicas; `playerSearchChanged(store, worldReplaced)` clears them in the mutation finally (before `activity` is released). Tests that edit players with `store.run` must call it.
- Verification: no SQL available again (Docker socket denied); app.test additions (paging/sort consistency, fogged rivals on /api/transfers and /interest) are unrun.

### 2026-09-26T20:00:00+02:00 — Career load speed (branch squad/world-rebuild-2, uncommitted)
- Load path is `Saves.loadCareer` (saves.ts; app.ts route now a one-liner). Restore validates WHILE downloading: `Readable.from(writeThrough(tmp, chunks()))` -> `readCheckpoint`; download errors are captured on the storedChunks wrapper (not writeThrough) because `Readable.from` destroy injects the consumer's error via `iterator.throw()` at the outer yield.
- "Unchanged since last save" = content digest (`worldDigest`: versions + per-table name/columns/rowCount/row-line sha256, no createdAt), stored in `save_slots.career_metadata.worldDigest` (no migration), stripped in slotFromRow. Only the career's NEWEST manual or an imported slot may stand in for the before-load archive (autosaves rotate at 3; older manuals rotate earlier than a fresh archive would). Cooperative counters rejected: any write path that forgets the bump loses progress.
- Skipped archive still scans+gzips to a local temp file (digest needs the rows); it saves the chunk INSERTs/log. Mismatch path stores that file (measuredStream sha compare) — no double scan.
- storedChunks reads 4 chunks/round trip with 1-ahead prefetch; attach `.catch(()=>{})` to the prefetch and await it in finally, else an abandoned generator leaves an unhandled rejection. Inside a Store transaction queries serialize on one connection, so "parallel" chunk download is impossible — prefetch only overlaps network with gunzip/parse.
- Restore flush 5000 rows/4 MiB (was 1000/1 MiB): each bulkInsert call pays SET IDENTITY_INSERT + reseed proc round trips. Checkpoint paging 4000 rows/4 MiB. Output bytes independent of both.
- app.test "loads the oldest manual save at the cap" now mutates the world first; with no change the archive is reused and nothing rotates.

📌 Team update (2026-09-26T21:00:00+02:00): Roadmap wave 1 puts F0 additive schema evolution (older snapshots restore with defaults) first and on Data; m8 = season stat line + durable totals, m9 = clauses/agents/callups/groups — decided by Lead
📌 Team update (2026-09-26T21:00:00+02:00): Call-ups need no schema change (meta `callUps`, setting `autoCallUps`, history `squad` rows with `callUp`/`callUpReturn`); ClubTransfers will need a `release` kind once roadmap A adds release/retirement rows — decided by Lead

### 2026-09-26T21:30:00+02:00 — Go-live integration audit (read-only) → decisions/inbox/data-audit-integration.md
- No schema change today; saves/live worlds compatible. Blocker = SQL tests never ran (Docker denied); CI `all` + full-world soak required on the committed SHA.
- T-SQL LIKE: `[` is a wildcard class; a JSON pattern like `'%"rivals":[{%'` matches nothing — use `[[]` or JSON_PATH_EXISTS.
- Never build per-key arrays with `[...old, id]` in loops over world-sized result sets (O(n²), blocks the 0.5-vCPU event loop).
- Caches keyed on `max(history.id)` go stale after restore reseeds identity; clear them on world replacement.
- The shared VS Code terminal lags one command behind: a `setsid bash script &` may only start when the NEXT command is sent; poll the log, never trust "[1] Done".

### 2026-09-26T22:30:00+02:00 — Wave 2 fixes (uncommitted) → decisions/inbox/data-fixes-wave2.md
- Append-only tables allow incremental caches: keep `maxId`, read `id > maxId AND id <= max(id)`, full rescan when `max(id)` drops or the career key changes; still clear on world replacement (restore reseeds identity). Tests that DELETE history rows must call `clubTransfersChanged(store)`.
- Build per-key arrays from world-sized scans with push into a fresh map, then one concat per key; never mutate arrays of a cached map (a failed build would leave it half-updated).
- Long cold builds: id-range batches + `await setImmediate` between them.
- GP_S_Gen5_2 (Free offer) = 150 concurrent workers/logins (Microsoft Learn vCore limits) → pool max 10.
- `CROSS` is a reserved word in T-SQL: never use it as a column alias.
- Calendar-date check: `new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v`; `daysBetween` returns NaN on impossible dates and silently bypasses caps.
- Loans between associations: FIFA max one year → validate at enquiry (Two-year loan) and offer (terms.duration) with `crossBorder` from clubs' `country_id`.
- Shared terminal output is unreliable with many agents: write command output to /tmp files and read them.

### 2026-09-27T00:10:00+02:00 — Release CI for features wave 1 (PR #9) + `--current-worlds` deploy gate → decisions/inbox/data-release-ci.md
- `NATIONAL` is a reserved T-SQL keyword: `OPENJSON(...) WITH (national int)` failed every batched match day ("Incorrect syntax near the keyword 'national'") and broke advance, the soak and e2e. Bracket JSON-mapped column names that could be keywords (`[national]`); reserved words bite in WITH column lists too, not only aliases.
- First SQL run of a big uncommitted wave: failures were mostly tests written blind against rules changed the same day (U21 = 5 national teams, 1.06x buyer ceiling, loan subsidy pricing, 50/85 refusal on buy-backs, 32-player call-up cap). Fix the test to the rule, not the rule to the test; keep the rule covered by a pure test.
- Deleting a generated club in a SQL test hits FKs (standings, fixtures): hide it by flipping `type` and restore it afterwards.
- CI speed-up without cancelling the PR run: push the fix to a separate probe branch and `gh workflow run verify.yml --ref <probe> -f suites=world|e2e|backend` (different concurrency group). The PR run keeps collecting failures from the other jobs.
- `setsid nohup bash script &` from the shared terminal often doesn't start on the first try when the script file was created moments before; re-run it and confirm with `pgrep -af`.
- Waiting on CI without `sleep`: `timeout N tail -n0 -F log | grep -m1 DONE` fed by a setsid poller that writes `gh run view --json` status lines every minute.

## Summarized (2026-09-26)
Condensed by Scribe on 2026-09-26T23:30:00+02:00 from 2 detailed entries and 2 team updates (2026-09-23T09:15 – 2026-09-23T13:56); the later entries above stay verbatim.
- 2026-09-23T09:15 team update: account-release verification gate (the checkpoint busy-response race had to pass before production; the browser suite was not certified).
- 2026-09-23T09:41 new-career 409 root cause: prepare built the expanded (~834k) world in one request and one transaction; the busy flag 409'd every same-account read incl. /api/me and the client reset the account. Prepare is atomic, but `POST /api/careers` is not idempotent. Reads took the exclusive applock on a 4-connection pool shared by all accounts.
- 2026-09-23T11:49 busy contract + delete career: `world_busy` 409 + Retry-After, ungated /api/me with `activity`, `DELETE /api/careers/active` with confirmation, classic prepare, career-delete script refusing dbo. Local real-size timings (prepare 54.6 s, start 178.5 s) mean the client must poll /api/me and never retry. Measurement scripts create `touchline_measure_<hex>` databases: list exact names, drop with a strict regex guard.
- 2026-09-23T13:56 team update: PR #3 (e80e867) shipped (classic world for new private careers, delete-active refuses dbo).
📌 Team update (2026-09-26T23:30:00+02:00): Lead C delivered `REVENUE_MARKET_FACTOR`, prize money, parachutes and `seasonBudgets` (unpaid instalments count) as pure helpers, not wired; every revenue caller must switch together — decided by Lead
