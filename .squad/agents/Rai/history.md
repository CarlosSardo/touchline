# Project Context

- **Owner:** Carlos Sardo
- **Project:** Touchline, a realism-focused football sporting-director simulation game
- **Stack:** TypeScript, React, Node.js, SQL Server/Azure SQL, Docker, Azure Container Apps
- **Created:** 2026-09-22

## Core Context

Rai reviews Touchline for high-signal privacy, security, bias, and harmful-content risks.

## Recent Updates

📌 Team initialized on 2026-09-22

## Learnings

- Pay particular attention to credentials, authenticated user data, PII in logs, and demographic simulation inputs.
- 2026-09-23 (e80e867): Account isolation lives in the per-account world router (`worlds` keyed by resolved store schema, app.ts ~990) — verify new routes stay on it and never take account/schema from the client. Operator scripts are the likelier PII leak: watch "diagnostic" dumps on lookup failure that list every account's identifiers.

### 2026-09-24T09:22:15+0200 — PR #6 RAI review

- Green verdict for the VS Code test-discovery change: no safety, credential, privacy, or responsible-AI findings. The `vitest.explorer` and `ms-playwright.playwright` extension identifiers were confirmed as established.
