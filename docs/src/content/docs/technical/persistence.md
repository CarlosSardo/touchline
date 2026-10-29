---
title: Persistence and saves
description: PostgreSQL world isolation, transactions, schema evolution, checkpoints and bounded storage.
---

# Persistence and saves

PostgreSQL is the authoritative runtime store. A local save directory, SQLite file or browser cache is not the career database.

## Database layout

One application database contains a separate `accounts` registry and one world schema per approved human. Registry users are keyed by `(issuer, subject)` and have a unique `game_schema` derived from an account UUID. `access_requests` records pending and denied access decisions. Local no-auth development uses the explicitly selected schema, normally `public`.

Each world contains its own football population, state, history and checkpoint catalog. The same application role owns these schemas; this is **application-enforced isolation**, not independent database credentials or a PostgreSQL row-level-security tenant per human. Compromise of the application role is outside that per-account boundary.

| World data group | Representative tables |
| --- | --- |
| Structure and current state | `meta`, `countries`, `leagues`, `clubs`, `players`, `staff`, `standings`, `fixtures` |
| Recruitment and commitments | `negotiations`, `loans`, `partnerships`, `transfer_payments`, `sell_on_clauses`, `buy_back_clauses` |
| Registration and eligibility | `registration_records`, `minor_applications`, `player_registrations`, `competition_registrations`, `player_gbe` |
| Evidence and sporting records | `player_minutes_monthly`, `club_season_outcomes`, `national_team_months`, `player_season_stats`, `player_match_appearances`, `discipline` |
| Club economy and life | `ledger`, `financial_periods`, `sanctions`, `club_projects`, `owners`, `club_ownership`, `ownership_events` |
| Career interaction/history | `reports`, `assignments`, `news`, `history`, `promises`, `unexpected_events`, player honours/injuries/milestones |
| Durable checkpoints | `save_slots`, `save_chunks` |

`WORLD_TABLES` in `server/sql-schema.ts` defines the complete export/reset world inventory. Not every nested domain concept deserves a separate table: player profiles/contracts, club policy details and negotiated deal data also live in structured JSON text columns, with SQL JSON operations where required.

## Store and consistency

`Store` wraps a `pg` pool. `forSchema()` creates an immutable schema-scoped view sharing the pool; checked-out clients have their `search_path` set before use. Gameplay SQL uses unqualified world table names and `?` placeholders, translated to PostgreSQL parameters. JavaScript arrays bind as PostgreSQL arrays for set-based operations such as `ANY(?::int[])`. Parameterized calls accept one statement, and bulk inserts are chunked to bound memory and parameter counts.

Async-local transaction context keeps operations on the correct connection. Nested transactions join the active unit of work; explicitly optional steps may use savepoints. Writers acquire an exclusive world advisory lock, while read-only transactions acquire its shared form. Read-only handlers cannot issue writes.

Large generation/replacement operations can use `batched()` to keep one session-level writer lock while committing smaller units, avoiding one enormous transaction. That path is not a promise of all-or-nothing generation. Portable restore/import, by contrast, validates and replaces the target world atomically.

HTTP operation state and database locks solve different problems: activity state gives prompt busy responses and invalidates caches; database locks coordinate consistent reads/writes across clients following the Store contract.

## Schema evolution

Account registry provisioning is separate from world migrations. Runtime startup validates, but never initializes either. Operators deliberately run `accounts:migrate` and `db:migrate --registered`; missing registered schemas fail closed rather than being recreated.

Numbered world migrations currently run from baseline 1 through 11: player storage, GBE evidence, registration tables, market/query indexes, sanctions, infrastructure projects, ownership, player records and indexed body measurements. The engineering guide owns the [operator migration procedure](https://github.com/CarlosSardo/touchline/blob/main/DEVELOPMENT.md#upgrades-and-migrations).

Do not edit shipped migrations. New tables must participate in the world inventory, identity reset where applicable and compatibility imports. `ADDED_WORLD_TABLES` allows older compatible checkpoints to omit later-introduced tables; domain-specific `ensure...` routines then rebuild appropriate derived state. A newer migration version is rejected by older code.

Schema migration version, procedural world version, checkpoint format/schema version and match rules version are distinct contracts. Increasing one is not automatically a valid upgrade strategy for the others.

## Checkpoints and portable files

The live world is committed as actions happen. A named or automatic save is a separate checkpoint, not the only copy of the active career.

`server/save-format.ts` defines a bounded, versioned, gzip-compressed portable stream with manifest/schema validation and digest checks. `server/saves.ts` streams tables in bounded pages and restores in bounded batches. PostgreSQL stores the catalog and chunked checkpoint bytes; temporary filesystem paths support streaming/import/export and are not durable storage.

Automatic saves rotate at 3 and manual saves at 10; imported checkpoints are protected from automatic rotation. UI import/restore replaces that account's active world in one transaction. File IDs do not authorize a different user's save.

World versions before 4 are rejected. Compatible older version-4 saves may restore later-added tables empty; GBE evidence, registrations, deterministic owners and supported player records are backfilled through the corresponding lazy paths. Missing historical injuries cannot be invented from absent records.

The full portable exporter writes registry data, worlds, snapshots and a manifest with hashes/completion/failure status. It supplements, rather than replaces, whole-database disaster recovery. Registry exports contain human identity data and must remain private.

## Storage is part of correctness

Full replay data is retained for followed fixtures; un-followed fixtures store compact results/scorer summaries instead of complete event and pitch-action detail. Season retention prunes bounded batches of obsolete entities and detail while preserving useful summaries and protected player context.

Player profile storage and fillfactor are tuned for frequent updates. Simulation vacuums outside transactions after appropriate busy/weekly/rollover passes to reclaim row versions before they grow without bound.

The footprint tool reports world and snapshot storage separately. Season soaks enforce player-row and fixture-scaled growth budgets, including a bounded first-season allowance for filling rolling evidence/history. Run soaks without concurrent long snapshots that prevent vacuum reclamation. Increasing a budget is not a substitute for finding a retention or query regression.

For recovery, use the [backup/restore runbook](https://github.com/CarlosSardo/touchline/blob/main/DEVELOPMENT.md#backups-and-restore), not reseeding or deleting a registry.
