# Project Context

- **Owner:** Carlos Sardo
- **Project:** Touchline, a realism-focused football sporting-director simulation game
- **Stack:** TypeScript, React, Vite, Express APIs, CSS, Playwright, Vitest
- **Created:** 2026-09-22

## Core Context

Product owns the playable React experience, responsive organization, accessibility, and end-to-end coverage. Important surfaces include `src/App.tsx`, `src/game-context.tsx`, `src/views/`, and `e2e/game.spec.ts`.

## Learnings

- Squad, academy, database, and transfer workflows must support dense scanning without sacrificing mobile usability.
- Player and club names should lead naturally to inspectable profiles and histories.

📌 Team update (2026-09-23T09:15:46+0200): Focused account-release verification gate for the per-user isolation release is now in decisions.md — known checkpoint busy-response race must be fixed and pass before production; full 38-scenario browser suite is not certified (initial run 7 passed, 1 failed, 30 unrun) — decided by Squad Coordinator

### 2026-09-23T09:41:05+0200: "Reconnect to account" dead end on new game (post PR #2)
- Server `read()` gate 409s EVERY read (/api/me, /api/bootstrap, /api/saves, /api/health/details) while any mutation holds the per-world `busy` flag (server/app.ts:1069-1109); per-user `careers/prepare` holds it for the whole multi-minute world build. Client must treat 409-busy as transient, never as a fatal account error.
- `loadSession` catch does `resetAccount()` + fatal `setError` for ANY failure (src/game-context.tsx:338-346). With the focus/visibilitychange `recheck` (:380-395, no retry, no in-flight-mutation guard) a tab switch during any long mutation (prepare, advance, save, import, export) produces the full-screen error, bumps `requestGeneration` and silently discards the in-flight mutation result.
- "Reconnect to account" and page reload are GET-only (me/bootstrap/me) and cannot restart world creation; only an explicit New career / Retry preparation click POSTs prepare, which the server 409s while running and makes idempotent after commit (server/saves.ts:645).
- Test-fixture rule: mocked account fixtures must mirror the server busy gate (409 reads while a held mutation runs) and dispatch focus/visibilitychange mid-mutation; e2e/accounts.spec.ts always returns 200 for reads, so it could not catch this.

### 2026-09-23T12:05:00+0200 — Busy-safe client + delete career (uncommitted on squad/new-career-busy-delete)
- One busy poller per tab in GameProvider (src/game-context.tsx): world_busy (409+code) from ANY api() call dispatches `touchline:world-busy`; /api/me with `activity` never resets the account. Polls 2/4/8 s then 10 s+jitter, keeps going while hidden (replica keep-alive). useResource pauses while `worldActivity` is set and swallows world_busy.
- Focus/visibility recheck skips while any non-GET api() is in flight (module counter) or a poll is scheduled/running.
- Prepare/Start career/Delete-active are sent once; 502/504/TypeError/world_busy = outcome unknown → `waitForIdle()` then decide from the reloaded bootstrap. 503 stays a real error (keeps the existing "failed preparation" test).
- Gotcha: loadSession calls resetAccount when the world disappears (delete) → children remount via Fragment key; set provider-level toast AFTER loadSession, and render the toast on Start (shell toast isn't mounted there).
- The accounts spec runs fully mocked against a bare `vite --port 5180` with TEST_URL (no SQL). Fixture now mirrors the server gate: `holdSlot()` sets activity; reads 409 world_busy + Retry-After 2; /api/me answers activity.

### 2026-09-23T12:50:00+0200 — Lead B1 revision: protected legacy career
- Saves.deleteActiveCareer refuses the legacy dbo world up front (409 career_protected, before any read/lock); Start.tsx needs no special branch — non-mismatch 409s fall through to the inline dialog ErrorState and keep the typed confirmation.
- Gotcha: e2e helpers noOverflow() and expectNoFatalScreen() both assert `.error-state` count 0, so a test that EXPECTS an inline error must check overflow before submitting and assert `.error-state` count 1 instead of calling either helper afterwards.
- game.spec.ts is serial and order-dependent: "startup waits for a local engine…" run alone with -g on a fresh world (started:false) ends on "No career started", so its "Continue career" assertion fails; the SQL runner spends ~11 min on world generation before any test runs.

### 2026-09-23T13:15:00+0200 — Lead A1: startup-retry e2e fixed (test only)
- Correction: the failure was NOT order-dependent — "Continue career" needs `state?.started && club` since PR #2 and no earlier test leaves a started career (Lead traced it). Grep the spec for the state-changing step before claiming an order dependency.
- Assertion is now `Continue career`.or(`Your private world is ready.`) — the latter renders only when `bootstrap` is loaded, so it proves the post-503 load.
- Reuse one seeded world for several checks: run `npm run test:local -- env SQL_SCHEMA=touchline_e2e_<32hex> API_PORT=… UI_PORT=… npx concurrently -k "tsx scripts/e2e-server.ts" "vite --host 127.0.0.1 --strictPort"`, then playwright with `TEST_URL`, `TOUCHLINE_E2E_SCHEMA`, `SQL_DATABASE=touchline_checks` (beforeAll checks databaseName). Stop by SIGTERM to the verified engine pid (check /proc/<pid>/environ SQL_SCHEMA).
- Gotcha: e2e-server dropOwnedSchema drops FKs/tables but not the `reseed_world_identity` procedure → DROP SCHEMA fails (3729), exit 1. Drop the procedure then the schema by exact name.

📌 Team update (2026-09-23T13:56:00+0200): New-career busy fix + Delete career shipped via PR #3 (e80e867) — client waits on 409 world_busy (poll /api/me, never auto-resend), 503 stays a real error, Start screen load/new/delete revamp, dbo guard revision approved — decided by Lead, Carlos Sardo

### 2026-09-23T14:05:00+0200 — Rai: blank career name bypassed delete confirmation (a51074b, squad/delete-followups)
- `??` only falls back on null/undefined; a "" careerName made the typed-confirmation target "" so an empty field matched. Use `x?.trim() || fallback` for any user-editable text that gates a destructive action, and require the target to be non-empty (`deleteConfirmed` guards both submit and the button).
- Covered by a mocked accounts.spec case at 1440/390/320 (blank careerName → must type "Account Fixture FC" exactly; case-mismatch and Enter stay inert).
- Gotcha: in a shared checkout with parallel agents, sync terminal output can show another agent's lines. Write all output plus the END marker into the /tmp log (`> log 2>&1; echo END >> log`) and read the log, rather than trusting piped stdout.

### 2026-09-24T09:22:15+0200 — VS Code test discovery
- Workspace recommendations now include `vitest.explorer` and `ms-playwright.playwright`; install them and reload VS Code once when the adapters are absent.
- Vitest discovery includes server/shared/src `test` and `spec` TS/TSX files while retaining the Node environment and SQL settings. Verified discovery: 304 Vitest tests in 13 files and 65 Playwright tests in 2 files.

### 2026-09-24T09:22:15+0200 — PR #6 package and merge

- Packaged the test-discovery change from an isolated worktree as commit `6f8efc8ffdb3fc12595938c6821c35a8c8ebb961`; PR #6 passed independent Lead and Rai review and merged normally as `38cf8108cae1074847901a655632a7ac825acfba`.
- Post-merge discovery remained 304 Vitest tests in 13 files and 65 Playwright tests in 2 files. These commands listed tests without executing them. Feature branches and the task worktree were removed, and GitHub identity was restored.
