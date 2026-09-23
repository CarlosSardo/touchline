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
