# RAI Audit Trail

> Append-only evidence log. Entries are redacted — never contains raw secrets or harmful content.

<!-- Rai appends findings below -->

### 2026-09-23T13:56:00+0200 — Pre-ship review of e80e867 (PR #3) — 🟡 Yellow
**Requested by:** Carlos Sardo · **Scope:** `git show e80e867` only (read-only, no tests run)
- 🟢 Credentials: none added; deploy smoke token still read from env.
- 🟢 SQL: new identifiers go through `quoteIdentifier`/`tableName`; values parameterized (saves.ts deleteActiveCareer, db.ts discardWorld, career-delete.ts).
- 🟢 Isolation: `DELETE /api/careers/active` runs on the per-account world router (keyed by resolved store schema); no client-supplied account/schema; dbo refused before any read (saves.ts:707); careerId+seed is a stale-state guard, not authz.
- 🟢 Busy body: `activity` is per-router, so 409/`/api/me` expose only the caller's own operation + startedAt.
- 🟡 PII: career-delete.ts:185 dumps every registered account's unmasked objectId/accountId/schema on a lookup miss (registryIdentifiers, :75-81); target summary prints displayName/tenantId/objectId (:198). Operator-only, but ends up in tee'd logs.
- 🟡 UX nit: Start.tsx:192 `??` lets an empty-string careerName make the typed confirmation trivially satisfiable.
Identifiers redacted; no account data recorded here.

### 2026-09-26T07:05:15+0200 — Final pre-merge pass, PR #7 (38cf810..14c1d6c) — 🟡 Yellow
**Requested by:** Carlos Sardo · **Scope:** `git diff 38cf810..origin/squad/world-rebuild` (110 files; 14c1d6c delta: 4 sim files, no RAI surface). Read-only; local probes only.
- 🟢 Round-2 names: `personName` redraws listed real people (server/people.ts:198-206); players, agents, managers and staff all use it. Probe: 218/220 famous names listed, the other 2 not producible, 0 exact draws in 660k samples (11 nations).
- 🟢 Round-2 pools: roster-built pools cleaned (shared/world-catalog/real-names.test.ts:52-56).
- 🟡 Round-2 clubs, partly resolved: exact names, numbers and listed variants are refused, but affix-swapped variants of listed clubs still generate (shared/world-catalog/index.ts:66-68 affix set; server/world.ts:346-348). planWorld probe, 11 nations: 64 near-copies (e.g. CD vs FC Paços de Ferreira). Fix: core-key comparison without generic club-type words, plus a per-nation planWorld test. Status: open.
- 🟢 Round-2 Crusaders: south-south/south-east regional rule only (shared/world-catalog/caf.ts:1288-1296).
- 🟢 Round-2 minors: under-18 lifestyle excludes nightlife/luxury (server/people.ts:827-832); no other assignment.
- 🟢 Round-2 backup: LUKS check, umask 077/chmod 700, LUKS-only second copy, dated deletion within 30 days (cloud-ship-runbook.md:84-86, 145-150, 176-185).
- 🟢 Credentials: none. CI SQL password generated per job, masked and redacted from logs (.github/actions/disposable-sql/action.yml:13-14); GHCR tokens via secrets/env only.
- 🟢 SQL: identifiers quoted (quoteIdentifier/tableName), values parameterized, lists via OPENJSON(?), sort via enum map (server/queries.ts:428-460), FK column lists regex-checked (scripts/world-reset.ts:105).
- 🟢 Reset/export output: masked schemas, counts only; registry file 0600, directories 0700.
- 🟡 PII: .squad/agents/cloud/history.md:27 adds 2 email addresses and tenant/subscription prefixes (values not recorded here). Fix: redact. Status: open.
- 🟡 PII (minor): scripts/azure-deploy.sh:86,88 print unmasked per-user schema names (they embed account IDs) into the tee'd release log. Fix: maskSchema. Status: open.
- 🟢 Content: added-line scan (slurs, hate, adult themes, policy terms) found only real names, places and real clubs; biographies are labelled fictional.
Identifiers redacted; no account data recorded here.

### 2026-09-26T10:05:00+0200 — Pre-merge re-check, PR #8 (2614708..4a87d4f) — 🟡 Yellow
**Requested by:** Carlos Sardo · **Scope:** `git diff origin/main..origin/squad/world-rebuild-2` plus the open PR #7 items on origin/main. Names probed on a git-archive snapshot of 2d0c0ca; the naming code is unchanged up to 4a87d4f. The IT/DK/SE catalog polish had not been pushed at 10:03. Read-only.
- 🟢 Item 1, mostly resolved: the team's `copiesRealClub` finds 0 of 2,519 (shared/world-catalog/index.ts:269). My independent probe (wider form list, spelling folds, spelled-out initials, prefix swaps) finds 0 identity copies and 0 one-word-shorter copies.
- 🟡 Item 1, remaining: 2 form swaps in SE, because BoIS is not a form word (index.ts:95-106). Examples: Göteborg BoIS ~ IFK Göteborg, Helsingborg BoIS ~ Helsingborgs IF. Fix: add "bois". Status: open (Lead-core).
- 🟡 Near-copies the rules miss:
  - IT cities have no demonym or adjective (uefa-west-b.ts ~407), so 6 bare-city names pass although the real club named after the city's adjective is listed (Salerno Calcio ~ Salernitana, SS Cremona ~ Cremonese).
  - 45 names swap a real "identity + city" club's city for one of its districts (Austria Favoriten ~ Austria Wien, Fortuna Benrath ~ Fortuna Düsseldorf, Standard Rocourt ~ Standard Liège).
  - Some real clubs are missing from the lists (Trastevere Calcio; IFK Rosengård vs FC Rosengård).
  - Fix: add IT adjectives; when a non-place identity word remains, map districts to their city before the identity check (index.ts:172, :269); extend the lists. Status: open, advisory.
- 🟢 Item 2: .squad/agents/cloud/history.md on main has no emails or IDs.
- 🟡 Item 3, partly resolved: schema names are masked (azure-deploy.sh:86-88), but the legacy guest's email and object ID remain in the dbo-binding error text (azure-deploy.sh:264 on the PR head, :262 on main). Fix: drop the email and mask the ID. Status: open (Cloud).
- 🟡 Already on main before PR #8: account emails and IDs in CONTRIBUTING.md:9, .squad/decisions.md:283 and .squad/memory (audit.jsonl:7, index.json:66). Policy allows no emails in .squad. Fix: redact. Status: open.
- 🟢 Lazy SQL: the 503 body is generic text plus code `database_unavailable` (server/db.ts:1269-1276, app.ts:1042), and the cause is never serialized. Auth returns 401 before SQL opens (app.ts:894 vs :1000). The startup log uses describeSqlError (env secrets and JWTs redacted) with the same content as before. The deploy smoke checks the /api/me shape without printing user fields.
- 🟢 Squad check and trialists: the only user-facing text is neutral B-team notices (server/simulation.ts). Trialists come from the existing youthPlayer/personName. A minor presence check was added (server/youth.ts minorMayJoin), and there is no demographic scoring. The 4a87d4f soak output shows fictional club names and counts only.
- 🟢 Credentials and SQL: none added. New SQL is parameterized (saves.ts: `keep` goes through slotId, then `IN (?, ?)`).
Identifiers redacted; no account data recorded here.

### 2026-09-26T21:30:00+0200 — Go-live review, uncommitted work on squad/world-rebuild-2 — 🟡 Yellow
**Requested by:** Carlos Sardo · **Scope:** `git diff` (36 files) + staged .squad/decisions-archive.md + 32 untracked files (call-ups, transfer battles, club transfers, player history, shared/features, new UI modules). Read-only.
- 🟢 Credentials: pattern scan (keys, tokens, passwords, connection strings, JWTs, private keys, SAS) of all changed/untracked content: 0 hits.
- 🟡 PII, new tracked file: .squad/decisions-archive.md (staged, not in HEAD) carries the owner's personal email (lines 32, 3164, 4274), the Touchline subscription ID (4267; prefix at 3164) and a corporate tenant prefix (4274). Moved from decisions.md, where they were already committed; .squad/decisions.md:52 still has the personal + corporate email and subscription ID. Repo is PRIVATE and these are the owner's own identifiers (not secrets), but policy allows no emails in .squad. Fix: replace with placeholders ("Touchline owner account", `<touchline-subscription>`). Status: open, advisory.
- 🟡 Carry-over: .squad/memory audit.jsonl + index.json (1 email each), CONTRIBUTING.md (1 ID). Status: open. azure-deploy.sh item from PR #8: resolved (0 emails/IDs).
- 🟢 Injection: new SQL interpolates only constants, `?` placeholder lists or OPENJSON(?); sort via zod enum + key map (server/queries.ts:415-436, :529-577). New GET routes parse ids with idSchema and query via zod (server/club-transfers.ts:37, :311).
- 🟢 Error leakage: 500 is generic and logs no cause (server/app.ts:1111-1114); 4xx bodies are GameError game text or zod path+message.
- 🟢 Frontend: no innerHTML/eval/web storage in new modules.
- 🟢 Content: coach reasons (server/callups.ts), rival/battle notices (server/transfer-battles.ts) and rumours (server/media.ts:243-305) are neutral. Unnamed rivals appear by country only; `named` is false only in the monitoring phase (transfer-battles.ts:619), which uses the country form. No award names in scope.
- 🟡 Advisory: male pronouns hard-coded in player-facing text (media.ts:279, :297; transfer-battles.ts:291). Fine for a men's-football sim; derive from player if women's squads are added.
- 🟡 Advisory, trademarks: real competition names are pre-existing by design (shared/competition-rules.ts:58; "Champions League" wording in server/recruitment.ts:313, server/people.ts:841), none new today. Call-up levels are generic ("first-team", "reserve-team", "U19", callups.ts:179); no federation brand names or logos added. Keep youth nationals as "<Country> U19/U21", not federation names.
- 🟢 Real names: new fixtures are fictional; no real clubs/players in changed source; server/world-club-names.test.ts guard unchanged.
Identifiers redacted; no account data recorded here.
