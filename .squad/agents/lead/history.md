# Project Context

- **Owner:** Carlos Sardo
- **Project:** Touchline, a realism-focused football sporting-director simulation game
- **Stack:** TypeScript, Node.js, Express, React, SQL Server/Azure SQL, Vitest, Playwright
- **Created:** 2026-09-22

## Core Context

Lead owns simulation, football rules, balancing, architecture, and code review. Important surfaces include `server/systems.ts`, simulation and world modules, and shared competition rules.

## Learnings

- Passing tests establish consistency, not real-world football realism; long-run outcomes need explicit validation.
- Save compatibility and private career state are invariants for gameplay evolution.
- 2026-09-23T09:15:46+0200: VS Code ignores tools: ["*"] in .agent.md; keep an explicit VS Code tools list alongside "*".
- 2026-09-23T09:15:46+0200: unanchored data/ in .gitignore hid .squad/agents/data/.
- 2026-09-23T10:30:00+0200: Exercise world-size defaults at real size over HTTP before shipping. PR #2's prepare test mocked generateWorld, so the expanded (~834k) default first ran in production. Classic = `expanded: false` (meta version 1, 160k).
- 2026-09-23T10:30:00+0200: Busy needs a machine-readable code (409 `world_busy`). /api/me must never share the busy gate or the world applock.

### 2026-09-23T12:50:00+0200 — Review: busy fix + delete career → REJECT (1 blocker)
- Blocker: per-account DELETE /api/careers/active had no dbo guard although the operator script refused dbo; Kiko's own router is dbo. Learning: when a tool has a safety guard (refuse dbo), check that every other path to the same destructive operation (API/UI) enforces it at the domain layer (Saves), not only the CLI.
- Guard errors must never use 401/403: the client treats those as session failure and resets the account. Use 409 + a specific code.
- Verified: bindSql schema scoping for bare table names, TRUNCATE rollback inside Store.transaction (injected-failure test), BIN2 career_id match. Revision → Product (Data locked out).

### 2026-09-23T13:00:00+0200 — Re-review → APPROVE; retro on the startup e2e
- B1 dbo guard verified. The startup e2e (game.spec:1177) was already broken at HEAD: 1acda49 gated "Continue career" on `state.started`, fresh e2e worlds are unstarted, and the only UI start runs later (2850).
- Earlier `/api/advance` tests restore pre-start checkpoints, so no earlier test starts the career.
- Learning: before gating on an existing test, trace its preconditions at HEAD, and git-log the asserted UI.

📌 Team update (2026-09-23T13:56:00+0200): New-career busy fix + Delete career shipped via PR #3 (e80e867) — 409 world_busy contract, ungated /api/me, classic world for new private careers, delete-active refuses dbo (409 career_protected); deploy/Rai review in progress — decided by Lead, Carlos Sardo
