---
title: Technical overview
description: The implemented Touchline architecture, engineering reference and operations guide.
---

# Technical overview

Touchline is a TypeScript football simulation delivered as a React browser application and an Express API, with PostgreSQL holding every career, snapshot and account registry. The supported production model is self-hosted on one Linux machine, with a Raspberry Pi 4B, 8 GB RAM and SSD as the reference host.

This section explains **how the solution fits together**. The repository's [engineering guide](https://github.com/CarlosSardo/touchline/blob/main/DEVELOPMENT.md) is the source of truth for commands, environment variables, setup, backups and recovery; it is intentionally not duplicated page-for-page here.

## Read by concern

| Reference | What it explains |
| --- | --- |
| [Solution architecture](architecture.md) | Runtime boundaries, stack, browser-to-database flow and source map |
| [Persistence and saves](persistence.md) | Account/world schemas, transactions, migrations, checkpoints and retention |
| [Simulation architecture](simulation.md) | World generation, daily/weekly/season orchestration, deterministic matches and shared policies |
| [Identity and access](identity.md) | OIDC, approval, cookies, account routing and isolation boundaries |
| [Delivery and operations](delivery.md) | Local tooling, test layers, Dagger, CI/CD and deployment topology |

## Design in one paragraph

The browser renders and requests game resources; it does not own authoritative gameplay state or run the server simulation. Express authenticates a session, resolves its approved account, selects that account's immutable schema-scoped `Store`, validates requests and invokes domain modules. Simulation and persistence run in the same Node process. PostgreSQL serializes world access with advisory locks and stores both relational records and structured profile/configuration data. Production serves the built UI and API from one application container behind an HTTPS proxy; an external identity provider proves identity but does not choose or own the world.

## Current, not historical

The source was reviewed at main commit `514e1e8` after removal of Squad integration. Git history explains several important boundaries:

- The initial local/SQLite and later Azure SQL hosting are retired, not alternate supported deployment targets.
- The version-4 curated world established the current procedural catalog and save-compatibility floor.
- Account isolation introduced a separate world per authenticated human.
- The PostgreSQL/Pi/OIDC transition replaced Azure SQL, Microsoft object-ID allow-lists and email invites.
- Later work added living-world policy snapshots, ownership, retention-aware simulation, container-isolated test shards and outbound-only Pi deployment.

These are architectural context, not claims that every historical feature or deployment remains supported. [REQUIREMENTS.md](https://github.com/CarlosSardo/touchline/blob/main/REQUIREMENTS.md) distinguishes implemented game behavior from realism gaps. [CONTRIBUTING.md](https://github.com/CarlosSardo/touchline/blob/main/CONTRIBUTING.md) carries contributor invariants.
