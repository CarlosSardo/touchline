# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
| --- | --- | --- |
| Game simulation and football rules | Lead | Match and transfer systems, competitions, registration, finances, youth development, balancing |
| Architecture and cross-domain review | Lead | Shared contracts, system boundaries, technical decisions, code review |
| Product workflows and React UI | Product | Views, navigation, game interactions, API flows, information architecture |
| Responsive UX, accessibility, and browser tests | Product | Mobile layouts, interaction states, Playwright coverage, visual regressions |
| SQL schema and persistence | Data | Tables, queries, saves, snapshots, transactions, logical data design |
| Identity, isolation, and data migrations | Data | Account mapping, per-user careers, authorization boundaries, migration safety, integration tests |
| Azure infrastructure and deployment | Cloud | Container Apps, Azure SQL operations, Entra ID, Key Vault, networking, CI/CD |
| Cloud operations and governance | Cloud | Observability, backups, rollback, security posture, reliability, quota, and cost controls |
| External facts and football regulations | Fact Checker | Rule verification, source checks, counter-hypotheses, factual audits |
| Safety, privacy, and responsible content | Rai | Credential exposure, PII handling, harmful content, bias indicators |
| Work queue and continuity | Ralph | Backlog monitoring, stalled work, keep-alive, follow-up tracking |
| Decisions and team memory | Scribe | Session logs, decision merging, cross-agent context propagation |

## Issue Routing

| Label | Action | Who |
| --- | --- | --- |
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
