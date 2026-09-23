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
