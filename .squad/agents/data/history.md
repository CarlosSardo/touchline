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
