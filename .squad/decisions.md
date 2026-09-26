# Squad Decisions

## Active Decisions

### 2026-09-22T14:39:36.069Z: Proactive release progress updates
<!-- memory-id: 0473dd28-a22d-4674-b35c-c0c56b678c08 | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/carlos-sardo-via-squad-proactive-release-progress-updates-0473dd28.md -->
**By:** Carlos Sardo via Squad
**What:** User directive (Carlos Sardo, 2026-09-22): provide more proactive status updates in chat during ongoing work. Report concrete progress, current action, blockers and next gate at roughly 30-second intervals and after meaningful batches; do not leave long-running delegated work silent. User also authorizes a new feature PR for commit/push if required by branch policy. Existing approval to finish, commit, push and ship the per-user isolation feature remains active.
**Why:** User request — captured for team memory.

### 2026-09-23T10:29:00+0200: User directive — new-career busy fix scope
<!-- memory-id: 34150fc2-7fc4-4506-acfd-607c762d55cc | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-new-career-busy-fix-classic-world-quick-fix-ship-when-verified-34150fc2.md -->
**By:** Carlos Sardo (via Squad)
**What:** New private careers get the CLASSIC world (160k players) instead of the expanded default (~834k). Build the QUICK fix only: a server "busy" answer no longer breaks the session; the app waits, shows that the world is still being built and reconnects on its own. The background-job world build and a retry-safe Start career were offered and NOT chosen for now. Ship to production once verified (user answered "Yes, ship when verified").
**Why:** User decision after the 2026-09-23 "Reconnect to account" regression on New career (PR #2) — captured for team memory.

### 2026-09-23T13:55:00+0200: User directive — Azure CLI account
<!-- memory-id: 8f649cfb-0d12-4209-96ca-c105ce29c4e6 | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-azure-cli-must-use-carlos-sardo-outlook-com-for-touchline-8f649cfb.md -->
**By:** Carlos Sardo (via Squad)
**What:** Whenever Azure access is needed for Touchline, first switch the Azure CLI to the <owner-email> account, subscription <touchline-subscription> (`az account set --subscription <touchline-subscription>`), and verify with `az account show`. The machine default is <owner-work-email>, which is the wrong account. Also: finish, deploy, commit and push the busy/delete fix; fan out work.
**Why:** User request — captured for team memory.

### 2026-09-26T18:36:37+02:00: Players can refuse personal terms; negotiation fee fixes
<!-- merged-from: decisions/inbox/lead-transfer-interest-fixes.md -->
**By:** Lead (requested by Carlos Sardo)

**What:**
- Refusal rule (server/recruitment.ts): `moveScore` = interest score with the wage factor removed. When `moveScore < 25`
  (MOVE_REFUSAL_THRESHOLD, the "Not interested" band) the player refuses personal terms outright: the negotiation
  closes as `Rejected` with the reason in history. Acceptance still needs overall score >= 35 plus the wage floor;
  wages stay capped at +15. `personalTermsOutcome()` is the single decision (refused / hesitant / wage / agreed).
  `PlayerInterest` gains optional `moveScore` and `refuses`; a refusing player's stance is always "Not interested",
  so the live `/players/:id/interest` preview tells the director before an offer is made.
- Applies to buying, renewals (incl. assistant drafts) and players the user is selling: the buyer-managed agent talks
  now end in a refusal plus a Transfers news item instead of silently looping until tension hits 90.
- AI incoming offers store the player's real interest (was hardcoded 75).
- Club talks counter no longer lowers `asking_price` (lowball bids eroded it 4% per round) and never counters at the
  user's own bid: counter = ceil(max(floor, 96% of asking)).
- Personal talks budget the agreed fee (not the request's fee, which could be 0) plus the agent commission, matching
  what registration charges; renewals are included (registration already charged them).
- Incoming counter: the buyer's ceiling uses max(asking, its own bid) and is a whole number (a rounded-up quoted
  maximum used to be declined).

**Why:** A "Not interested" player could never reject: agent talks only answered "not ready" until tension reached 90,
and money plus role could buy any move past formal talks.

**Team notes:** Product may want to show `data.counter` for outgoing club talks (asking price now stays at the
club's valuation; the counter is in the response message) and surface `refuses` in InterestSummary.

**Superseded in part (2026-09-26T19:00:00+02:00):** the moveScore < 25 refusal and >= 35 acceptance thresholds are replaced by the 50 / 85 bands (see "Player interest thresholds 50 / 85"). The fee and counter fixes stand.

### 2026-09-26T18:36:37+02:00: Negotiation UI — currency of server text and rejection surfacing
<!-- merged-from: decisions/inbox/product-negotiation-ui.md -->
**By:** Product (requested by Carlos Sardo)
**What:**
- Server-written negotiation/interest messages format amounts in GBP (rules.money default). The client now converts `£` amounts in that text to the career display currency via `useCurrency().text()` (src/money-text.ts). Preferred long-term fix (Lead): keep putting the numbers in structured fields (`data.counter`, `data.requiredWage`, `interestDetails.expectedWage`) — the UI already displays those in the right currency.
- A counterpart rejection is identified by `ActionResult.stage === "Rejected"` from `offer`/`negotiation` actions; the UI shows it as an error toast, keeps the negotiation on screen (red latest response), and shows the last message of the latest closed talks on the offer form. Any new server rejection reason should go into the negotiation log message (`data.log[].message`) and the action `message`; no new API field is required by the UI.
**Why:** Values in the latest response disagreed with the inputs for non-GBP careers, and a rejected deal disappeared from the offer page without explanation.

### 2026-09-26T18:50+02:00: User directive — player interest thresholds
<!-- merged-from: decisions/inbox/copilot-directive-2026-09-26T18-50-interest-thresholds.md -->
**By:** Carlos Sardo (via Copilot)
**What:** A player whose interest is below 50% does not negotiate with the club at all (refuses outright). A player only accepts personal terms once interest is 85% or higher. AI-to-AI transfers must also respect player interest (do not ignore it).
**Why:** User request — captured for team memory. Supersedes Lead's moveScore < 25 refusal / >= 35 acceptance thresholds from earlier today.

### 2026-09-25T17:59:53+0200: User directive + autonomous decisions — full world/database rebuild
<!-- archived-from: decisions/inbox/copilot-world-rebuild-directive.md -->
**By:** Carlos Sardo. What (user directive, lightly paraphrased): Full text: decisions-archive.md.

### 2026-09-25T19:36:44+0200: User directive — real life wins; as good and fast as possible
<!-- archived-from: decisions/inbox/copilot-directive-2026-09-25T19-36-realism.md -->
**By:** Carlos Sardo. Where Carlos's list or the plan conflicts with real-world football, do what is true in real life. Full text: decisions-archive.md.

### 2026-09-26T11:40:22+0200: User directive — go live without a backup or a longer test
<!-- archived-from: decisions/inbox/copilot-directive-2026-09-26T11-40-ship-no-backup.md -->
**By:** Carlos Sardo. Ship v4 to Azure now: skip the pre-wipe backup and its verification, wipe the old worlds and saves, deploy the image of main@589c5de… Full text: decisions-archive.md.

### 2026-09-26T18:50:00+02:00: Player history API — `GET /api/players/:id/history` (contract for Product)
<!-- merged-from: decisions/inbox/data-player-history-contract.md -->
**By:** Data (requested by Carlos Sardo). Active contract; server implemented, unmerged (squad/world-rebuild-2).
**What:**
- `PlayerHistory { playerId, moves: PlayerMove[] (oldest first, latest 500, movesTruncated), seasons: PlayerSeasonStats[] (newest first), career }` in shared/api.ts; 404 unknown player; shared read lock, 409 `world_busy` while saving/advancing.
- `PlayerMove.kind`: transfer, free, loan, loanReturn, loanRecall, loanPurchase, registration, squad. `fee` is GBP (null = not recorded); `dateEstimated` for old loan returns.
- UI rule (user decision): goals/assists/rating only where real data exists. `coverage: "none"` → "—", `"partial"` → say "N of M detailed matches", `"full"` → normal. A real 0 is `0`, never null.
- Not recorded yet: contract-expiry releases, retirements, AI age-group changes (roadmap item A / m8 adds `release`/`retirement`). Loans now store `loans.data.endedOn`.
**Why:** Product's PlayerHistory tab needs every move and season line without fabricated stats. Full text: decisions-archive.md.

### 2026-09-26T19:00:00+02:00: Player interest thresholds 50 / 85 (buying, selling, renewals, AI market)
<!-- merged-from: decisions/inbox/lead-interest-thresholds-50-85.md -->
**By:** Lead (implements Carlos Sardo's 18:50 directive)
**What:**
- `INTEREST_BANDS = { refuse: 50, interested: 70, agree: 85 }` (shared/rules.ts); `MOVE_REFUSAL_THRESHOLD` 50 and `PERSONAL_TERMS_THRESHOLD` 85 derive from it.
- `moveScore` (interest without the wage factor) < 50 → the player will not negotiate (enquiry `Rejected`; re-checked in formal/club talks and during personal talks). Terms agreed only at full score >= 85 plus the agent's wage floor; 50–84 keeps negotiating (+6 tension, `wageToAgree`).
- Wage contribution +48 per doubling over expectation, capped +35 (`WAGE_INTEREST_CAP`), floor −24.
- Renewals apply the same rule to interest in staying. Buyers of the user's players offer the wage that reaches 85 up to `MARKET_WAGE_PREMIUM_CAP` 1.5x, else the deal closes Rejected with a news item.
- AI-to-AI (`worldTransfers`, battle rivals): `marketMoveInterest` + `marketWageOffer`; a buyer completes only at move >= 50 and 1.5x(current wage + 10%) reaching 85, trying its top 8 candidates.
- `PlayerInterest` gains optional `thresholds { negotiate, agree }` (plus `moveScore`, `refuses`, `wageToAgree`); old saves fall back to `INTEREST_BANDS`.
- Calibration (pure probe): 86.2% (7 nations) / 95.0% (EN+ES) of attempts find a buyer in the top 8; completions stay at quota. Watch: AI wages rise from 1.10x to a median ~1.44–1.50x. If a soak shows payroll inflation, tune non-wage points or the premium cap, never the 50/85 bands.
- Product: InterestSummary uses `thresholds` — red "Won't negotiate (<50)", amber "Needs 85 to sign", green >= 85 (done this session).
**Why:** User directive. Full text: decisions-archive.md.

### 2026-09-26T19:00:00+02:00: All world reads take the SHARED world lock
<!-- merged-from: decisions/inbox/data-read-lock-shared.md -->
**By:** Data (requested by Carlos Sardo)
**What:**
- Every GET world route in server/app.ts goes through one `read` wrapper (`Store.readTransaction()`: `sp_getapplock` Shared on `touchline:world:<schema>`, transaction-owned, READ COMMITTED, 30 s, error 51000). Mutations, advances, saves and `batched()` keep Exclusive.
- Read handlers must be write-free (`run`/`exec`/`setMeta`/`bulkInsert`/`clearWorld` throw inside a read). A GET that needs to write must become a `mutation`. `/api/me` stays lock-free.
- Also: bootstrap world totals cached per Store (career/seed/date + max player/staff id); squad and club rosters filter on indexed `playing_club_id`.
- No index migration added. Migration 7 is reserved for `world_jobs`; feature migrations are 8 and 9 (see roadmap).
**Why:** Exclusive reads queued behind each other; with every writer exclusive, shared readers see a stable committed world, and reads never upgrade (no S→X deadlocks). SQL lock test not run locally (Docker socket). Full text: decisions-archive.md.

### 2026-09-26T19:00:00+02:00: Feature roadmap — foundations first, six waves (Lead)
<!-- merged-from: decisions/inbox/lead-feature-roadmap-2026-09-26.md -->
**By:** Lead (requested by Carlos Sardo). Planning only.
**What:**
- Features: A player history, B transfer battles, 2 dressing room, 3 board & jobs, 4 rival directors, 5 contract clauses/pre-contracts, 8 analytics department, 9 agents, 10 international call-ups/tournaments, 11 fans & ticket pricing, 12 awards, 13 records, 14 multi-club ownership.
- Foundations: **F0** additive schema evolution — older snapshots restore with defaults (Data, wave 1, first; without it every new table/column strands all saves because `checkpointSchema`/`validateManifest` are exact). **F1** season stat line (m8: `player_season_stats` + rating_sum, rated_apps, detailed_apps, xg_sum, shots). **F2** durable `player_club_totals`/`awards`/`records` with no player FKs. **F3** `server/relations.ts` relationship memory. **F4** `seasonClose` before retention. **F5** `server/hooks.ts` + `server/routes/` + `shared/features/<x>.ts`.
- Migration numbering: 1–6 exist, 7 = `world_jobs`, features take 8 and 9.
- Waves never share a file inside a wave; one hot-file owner per wave (simulation.ts, systems.ts, sql-schema.ts, calendar.ts, Transfers.tsx, ClubOffice.tsx, PlayerSheet.tsx). Perf rules: no per-player JS loops over the world; rollover work set-based, indexed, before retention; per-wave full-world soak vs the 290–350 s/week baseline.
- Fact Checker research (blocking where marked): multi-club rules (6a), release clauses by country (4a), pre-contracts (4a), international release + windows (5a), tournaments 2026–28 (5a), FIFA agent regulations (5b), generic award names (advisory).
- Open questions for Carlos: (1) show fast-model stats with a "result model" label? (2) awards/records/directors for all leagues or the user's only? (3) sacking as hard stop or live job market? (4) does the director run feeder-club transfers? (5) must pre-update saves stay restorable (F0 = L) or may releases start fresh worlds?
**Why:** A and B were half-built; the rest share four data needs. The strict checkpoint schema, the simulation/systems/app hot files and the SQL Free budget make foundations-first, one-owner-per-hot-file waves the only safe parallel order. Full text (per-feature table, wave table): decisions-archive.md.

### 2026-09-26T19:30:00+02:00: Transfer battles — rules, state and route/UI contract (Lead)
<!-- merged-from: decisions/inbox/lead-transfer-battles-contract.md -->
**By:** Lead (requested by Carlos Sardo). Active contract. Server in server/transfer-battles.ts, wired into the daily sim (`advance`: `processNegotiations` → `processTransferBattles` → payments … → `worldTransfers`), 15 pure tests.
**What:**
- Rivals only chase the director's club-to-club permanent purchases (Enquiry, Club talks, Agent talks, Contract review): ≤ 2 active, 5 days apart, ≤ 2 new/day world-wide, daily chance 4% (x2 public talks, x2 deadline week). A rival is a real club passing reputation/budget/squad/registration checks with `marketMoveInterest` >= 50 and a 1.5x-capped wage reaching 85.
- Lifecycle: monitoring → bid → (raise ≤ 2 / withdrawn) → fee-agreed (seller floor 88%) → terms (refuse < 50 or > 1.5x → lost) → 2-day decision. Seller may call best and final offers (3 days, once). Only packages >= 85 count; the director wins only in Agent talks/Contract review at >= 85 and within 3 points of the best rival. Rival win completes the AI move and closes the director's talks `Hijacked`. Signing first wins. Window close withdraws rivals. The abstract random "Hijack" event no longer fires for these purchases.
- State (no schema change): `negotiations.data.rivals`, `negotiations.data.battle`, `meta.rivalMarketBids` (≤ 20 shortlist alerts). Log entries `type: "Rival"` and news `data.rival: true` never show exact rival fees.
- Routes (Data, done): transfer desk → `withBattleViews`; `/api/players/:id/interest` → `withRivals`; any other raw negotiation row → `withoutRivalTruth`.
- Product renders only view fields: `negotiation.battle` (`open`/`final-offers`/`decision`, deadlines, `leadingBid` range, `message`) and `RivalInterest[]` (anonymous while `rumoured`, `feeRange`, `preference`). Never render `data.rivals`/`data.battle`. Amounts are GBP numbers.
**Why:** Rivals must really compete within the window, caps and 50/85 interest, and be seen only through scouting/press fog. Full text: decisions-archive.md.

### 2026-09-26T19:30:00+02:00: Club transfer pages — `GET /api/clubs/:id/transfers` (Data)
<!-- merged-from: decisions/inbox/data-club-transfers-api.md -->
**By:** Data (requested by Carlos Sardo). Active contract; code in server/club-transfers.ts.
**What:**
- `?season=&direction=in|out|all&type=kind[,kind]&page=&pageSize=` (shared read lock) → `ClubTransfers` (shared/api.ts): `club`, `seasons[]` with unfiltered totals (spent, received, net, counts, unknownFees), `filter`, `groups[]` per season (newest first), paging, `truncated`. Defaults all/all/1/100 (max 500); 400 bad params, 404 unknown club. `ClubTransfer.kind` reuses `PlayerMoveKind`.
- Sources: history `transfer`/`loan`/`squad`, the `loans` table, `negotiations.data.transferTerms` (user deals only).
- Gaps: releases/retirements not listed until roadmap A adds history rows (endpoint then needs a `release` kind); AI deals carry no terms; later sell-on payments not listed; totals use agreed fees.
- Perf: history has no club key — first load is one backward PK scan filtered by JSON_VALUE (TOP 20,001), cached per Store+club (LRU 16) until max(history.id) changes. Proposed for migration 8+: computed `from_club_id`/`to_club_id` + filtered indexes, or a narrow `club_moves` table.
**Why:** Product's ClubTransfers tab. Unmeasured on SQL. Full text: decisions-archive.md.

### 2026-09-26T20:00:00+02:00: Faster career load; before-load archive skipped only for a byte-identical world (Data)
<!-- merged-from: decisions/inbox/data-career-load-speed.md -->
**By:** Data (requested by Carlos Sardo)
**What:**
- `POST /api/careers/load` → `Saves.loadCareer(file)`, one transaction. The slot is validated while it downloads (same checks, all before `clearWorld`), removing a full gunzip + parse pass.
- `worldDigest(summary)` (save-format.ts): SHA-256 over format/schema versions and each table's name, columns, row count and row-line hash (no createdAt/provenance). Stored as `worldDigest` in `save_slots.career_metadata` JSON (no schema change; stripped from the API). The before-load archive is skipped only if the current world's digest equals the career's newest non-imported manual save or an imported save with structurally intact chunks; autosaves never qualify; older saves without a digest always archive. Cooperative mutation counters were rejected (a skipped bump would lose progress).
- Bigger batches: chunk reads 4 per round trip + prefetch; checkpoint scan 4000 rows / 4 MiB; restore bulk 5000 rows / 4 MiB. Checkpoint bytes are unchanged.
- Proposal only: restore into a staging schema and swap.
**Open:** SQL tests not run locally (Docker socket); CI must run SQL_SAVE_TESTS incl. the new archive-skip test and the app.test at-cap load test. A skipped archive still costs one scan + gzip for the digest. Full text: decisions-archive.md.

### 2026-09-26T20:30:00+02:00: Player Database search — index-only ranking, capped counts, rival fog on routes (Data)
<!-- merged-from: decisions/inbox/data-player-filter-perf.md -->
**By:** Data (requested by Carlos Sardo)
**What:**
- `GET /api/players` runs three phases: (1) match set — `count(*)` over `TOP (10001)` ids (ids themselves for JSON filters), cached per Store (LRU 32, 10 min TTL, cleared after every mutation via `playerSearchChanged`); (2) page of ids, written as self-joins on nonclustered indexes when possible so wide clustered rows are never scanned; (3) display rows for ≤ 100 ids via OPENJSON.
- Default ranges are omitted; valueMax/wageMax 1e9 = no limit. Nationality = indexed `country_id` OR a per-Store secondary-nationals map. `q` = name LIKE OR country/club id IN LIKE matches.
- API (additive): `PlayerPage.totalCapped?: boolean` — when true `total` is 10,000 (`PLAYER_SEARCH_CAP`); show "10,000+". Unfiltered search returns the exact total.
- Rival truth wrappers wired: `/api/transfers` negotiations → `withBattleViews`, `/api/players/:id/interest` → `withRivals`.
**Open:** sorts/filters on age tie-break, form, fitness, contract, height, traits etc. still scan clustered rows (cached once per filter); real fix = computed columns + covering index in a later migration (proposed only). No SQL timings; cache is per process (valid for 0..1 replicas; operator scripts bounded by the TTL). Full text: decisions-archive.md.

### 2026-09-26T20:30:00+02:00: Call-up realism — calibration defaults, eligibility rules, DA brief (Fact Checker)
<!-- merged-from: decisions/inbox/fact-checker-callup-realism.md -->
**By:** Fact Checker (requested by Carlos Sardo). Advisory for Lead's call-up system.
**What:**
- Evidence: Nwaneri (PL 15y181d, injuries forced U21s onto the bench), Yamal (late-season 83' sub in a 4–0 win, stayed B-registered), Moukoko (DFL age 16 since 2020; age disputed, don't calibrate on him). 3/3 debuts were late cameos in won games — a pattern, not a statistic. No quantitative CIES source found; every ⚠️ number is a tunable heuristic.
- Suggested defaults: debut budget 2–4 per club/season by tier (+1–2 in injury crises), minimum senior age ENG/ESP 15, GER/others 16, median debut ~18.5, debut sub minute >= 75', score gate (lead >= 2, dead rubber or lower-tier cup tie), U17→U19 any-minutes share 0.15–0.25, U19→B 0.35, 70% single-match call-ups, end-of-season multipliers x2.5/x3, merit gate (>= 90% of weakest senior or top-3 prospect).
- Eligibility by country as per-country config: ENG PL2 U21 (over-age count unverified); GER II teams barred from top two tiers/Pokal, four-game stand-down relaxed for U23; ESP B-teams same pyramid, U23/U25 switch rule unverified; ITA Serie C second teams (≤ 4 over-23, not on the Serie A 25-man list, ≤ 50 Serie A apps); NED Jong teams move only in windows unless < 15 first-team apps (2013 source); FRA reserves capped at N2/N3.
- DA: inert-system risk (add development requests, a bench floor for top prospects, reason strings); over-blooding (hard budget, count first appearances only); exploit (coach decides, age floor, over-promotion cost); silent ineligibility (badge + countdown); calendar collisions (reserve the fixture, carry fatigue); rule drift (re-verify before UI claims); the injury-crisis path must bypass the score gate.
**Recommendation:** proceed; ship ✅ rules as per-country config, treat ⚠️ numbers as tunable, add a sim check that per-club debut/call-up counts fall in the bands. Full text: decisions-archive.md.

### 2026-09-26T23:30:00+02:00: Call-ups inside the club family — design and calibration (consolidated)
<!-- merged-from: decisions.md "Call-ups inside the club family" (20:30) + decisions/inbox/lead-callups.md (21:00) -->
**By:** Lead, calibrated to Fact Checker's call-up brief (requested by Carlos Sardo). Server in server/callups.ts, uncommitted; no schema change.
**What:**
- State: moves use `players.age_group` + `squad_club_id`; bookkeeping in meta `callUps` (`CallUpMeta`); setting `autoCallUps` (default true); history `squad` rows with `callUp`/`callUpReturn`. Family: first team ← B-teams, U19; B-team ← U19; U19 ← U17. All call-ups end at rollover (`endAllCallUps`, first rollover step). Every rate lives in `CALL_UP_RULES`.
- Debut budget by club standing (elite/mid 2, bottom top flight/tier 2/tier 3+ 3; +1 academy ≥ 80 or "Develop and sell"; cap 3/3/3/3/4; injury crisis +1/+2). Consumed only by debuts actually played. Debut = age ≤ 21 with no senior first-team appearance (Lead D).
- Debut context (user's first team, full engine): bench start, on from 75' when 2+ up, any score in a dead rubber / cup tie vs lower tier; `MatchPlayer.callUpDebut` lead/open/hold. Senior age floor EN/ES 15, others 16. Only Italy's 50-top-flight-apps second-team bar is modelled.
- Merit: 90%-of-weakest-incumbent gate for debutants/top-3 prospects/requests; ~75% single-match call-ups; end of season = last 4 league rounds (x2.5, final round x3). DA mitigations: `call-up-development` requests (max 3), coach verdict strings, top-3 prospect bench floor in tiers 1–2.
- Probe (pure, 482 families): debuts per club inside Fact Checker's bands (elite 2.62, tier 2 2.20; AI bottom top flight 1.20 and tier 3+ 1.37 slightly low).
**Open:** callups.sql.test.ts NOT run; SQL soak should confirm debuts/season; AI clubs have no budget (max 5). Full text: decisions-archive.md.

### 2026-09-26T23:30:00+02:00: Call-ups API contract and UI (consolidated)
<!-- merged-from: decisions.md "Call-ups API contract" (20:30) + decisions/inbox/lead-callups-contract.md + decisions/inbox/product-callups-ui.md (21:00) -->
**By:** Lead (contract), Product (UI). Active contract; types additive in `shared/features/callups.ts`.
**What:**
- `GET /api/call-ups` → `CallUpDesk { autoCallUps, active, proposals, debutBudgets[] (limit, used = played + running debut call-ups, played?), teams[], requests? }`. Refresh after `/api/advance` and every action.
- `POST /api/action`: `call-up` (match | days 1..120 | until real date | permanent), `call-up-end` (14-day coach block), `call-up-proposal` (decline = 7-day block), `call-up-development { playerId, active }` (max 3; 400 if first team or limit). Errors are 400 `GameError` shown as-is (age floor, Italy 50-apps bar).
- `PATCH /api/settings { autoCallUps }`. Coach call-ups post `Squad` news (`data.callUp`). `CallUp.development?` → "Development" badge.
- UI (Product): Squad "Call-ups" tab (`CallUpsPanel`), `CallUpDialog` from squad rows; PlayerSheet uses one "Playing squad" + "Duration" control (fix 2). History folds call-up + return into one line via `collapseCallUps`; Data now forwards `callUp`/`callUpReturn`/`until` on `PlayerMove` and `ClubTransfer`.
- Copy: never describe the German 4-game stand-down, Dutch 15-apps rule, Spanish U23/U25 switch or PL2 over-age count as real rules.
**Why:** Product's call-up UI. Full text (type shapes): decisions-archive.md.

### 2026-09-26T21:30:00+02:00: RAI go-live review — 🟡 Yellow, ship allowed (Rai)
<!-- merged-from: decisions/inbox/rai-release-review.md -->
**By:** Rai (requested by Carlos Sardo). Read-only review of the uncommitted squad/world-rebuild-2 work.
**What:** No 🔴. No credentials; SQL parameterized, sorts allow-listed, new GETs zod-validated, generic 500s; coach/rival/rumour text neutral, unnamed rivals by country only, no real clubs/players added. Advisory: owner email, subscription ID and tenant prefix appeared in .squad/decisions.md, decisions-archive.md and .squad/memory → Scribe replaced them with placeholders (2026-09-26T23:30). Keep youth nationals named "<Country> U19/U21", never federation brands.
**Why:** Pre-ship RAI gate. Evidence (redacted): .squad/rai/audit-trail.md. Full text: decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Cloud — go-live runbook for today's features
<!-- merged-from: decisions/inbox/cloud-go-live-runbook.md -->
**By:** Cloud (requested by Carlos Sardo). Advisory, read-only (ARM, GitHub API, one Graph read).
**What:**
- Live: revision `touchline--d20260926095010-765503` = main@589c5de (PR #8), schema 6, 0..1 replicas. The older inactive v3 revision is NOT a rollback target. Today's work is uncommitted (36 modified + 31 untracked files).
- CI path: commit on a new branch from origin/main (trees are equal), open a PR, let verify.yml run all 5 jobs (~38 min) with no pushes during the run. Green = 5/5 success on the final head SHA with the `.sql.test.ts` suites visibly run, then Lead review, Rai, squash-merge, image.yml green on the merge SHA.
- **B1 deploy gate:** default mode needs a career in dbo, `--empty-worlds` needs every world empty; with the owner's v4 world and an empty dbo both refuse. Option B (recommended): kiko starts his career on the live build first. Option A: "empty or v4" gate (untested in CI).
- Compatible: no migration, WORLD_VERSION 4, new state in meta/JSON only; no one needs a new career; deploy with `--skip-db-prepare --verification smoke` by digest from the clean release worktree; owner `/api/me` 200 within 120 s is mandatory. Rollback = traffic switch to the current revision.
- Budget: ~6,970 vCore-s left until 2026-10-01; after kiko's first build and the deploy ≈ 60–90 online minutes for everyone. 1 October is the safer date for sustained play. Actions minutes (2,000/month) are a risk.
**Why:** Go/no-go checklist for putting today's features live. Full text (commands, checklist): decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Data audit — integration of today's uncommitted changes (read-only)
<!-- merged-from: decisions/inbox/data-audit-integration.md -->
**By:** Data (audit role, requested by Carlos Sardo).
**What:**
- Verified locally: server/app tsc, oxlint, 197 pure tests, db.test no-database. Save compatibility and account isolation: no blocker (schema unchanged, new state additive JSON, caches `WeakMap<Store>`, rival truth stripped on routes).
- 🔴 Blocker: none of today's SQL paths (shared read lock, call-ups, transfer battles, archive skip, player search, club transfers) has run on SQL. Commit, then CI verify `all` on that SHA before deploying; named tests in db/saves/app/systems/callups.sql/transfer-battles.sql/accounts.
- 🟠 Commit every untracked file (imports would break CI); T-SQL `LIKE '%"rivals":[{%'` never matches (fixed by Lead C); club-transfers first-load scan repeated daily; nationality index O(n²); SQL pool of 4 (all fixed in Data wave 2).
- 🟡 cache clears on world replacement, `until` date validation, call-ups in club totals (fixed); rival truth in exported saves (accepted); in-flight negotiations re-scored with 50/85 after deploy (release note).
**Why:** Pre-go-live integration check. Full text: decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Audit — match engine, competitions, calendar (Lead, read-only)
<!-- merged-from: decisions/inbox/lead-audit-match-competitions.md -->
**By:** Lead (audit role). Pure probe, 1,500 v3/fast matches per scenario; no SQL.
**What:** 🔴 byes appended after winners (top seeds meet in R2); B-team/called-up bans served in the wrong team's matches and shared first-team discipline scope; fast model could substitute a dismissed player. 🟠 knockout results in league-phase tables; cups end months early, `seededEntry` unused; two "Round of 16" rounds; minutes include stoppage; play-offs in the cup discipline scope; injured-keeper debut gate; AI call-ups ignore rest days; continental two-legged rules. 🟡 penalties ~10x too rare (0.027/match), goals 3.30 and uniform, fully seeded cup draws, fixtures repeat every season, tiebreakers ignored, uniform subs, long stoppage, fast-vs-v3 upset gap, set-piece headers to one CB, subs at full ability out of position, one calendar for all leagues.
**Why:** Whole-game sweep before fixes; most items fixed by Lead A/B (below). Full text: decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Audit — transfers, contracts, loans, finance (Lead, read-only)
<!-- merged-from: decisions/inbox/lead-audit-transfers-finance.md -->
**By:** Lead (audit role). Code read + pure economy probe (15 nations, 59k players); no SQL soak.
**What:** 🔴 R1 loan terms user-controlled and unpriced (£100M bonus, £0 option, 100% sell-on, 0% wage split); R2 small-league wage expectations use the English `baseWage` (3–7x local wages; renewals and sales break). 🟠 unpaid instalments not a budget liability; budget slider ratchets wage budget; lower tiers structurally loss-making (staff wages double-counted); promotion/relegation economics missing; contract ends exceed FIFA maxima; `exerciseOption` ignores window/consent; user renewals +~50% each; AI free agents ignore interest; AI wages anchored to the seller's scale. 💰 buy-low/flip-high ~49%; academy raids for ≤ £60k. 🟡 revenue ignores market size, value inflation without economic inflation, thin AI market, one global window, FIFA loan limits absent.
**Assessment:** 50/85 applied consistently; AI payroll inflation bounded, not runaway. Fix order R1 → R2 → O1/O2 → O5/O6 → O3/O4 → O7–O9 → X1/X2. Full text (probe table): decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Audit — youth, growth, retirement, staff, registration, events, media (Lead, read-only)
<!-- merged-from: decisions/inbox/lead-audit-youth-people.md -->
**By:** Lead (audit role). Two pure probes (7 nations, 40k players, 12 seasons); no SQL.
**What:** Headline: development inflates the world (53% of a 15-year-old intake ≥ 85 after 12 seasons; p90 99 at 26–30), then veterans collapse. 🔴 potential factors not centred (+2–5/season for everyone); ability grows at a fixed age rate regardless of minutes; the engine uses generation-time attributes (UI shows adjusted ones); the user's club trains attributes 4x faster, keepers never train goalkeeping. 🟠 decline sped up by good staff/professionalism with a cliff at 30; no GK retirement/peak offset; staff ability inflates to 99 and the staff world is static; no homegrown/25-man rules; retirements and B-team expiries hit the user silently; minors' positive lifestyles never re-rolled. 🟡 youth/senior generation gap, scouting never decays, events repeat off-calendar, media headline/roundup slips, foreign quota counts reserves, debut budget spent on reserve veterans, flat injuries, affiliates at every tier.
**Why:** Fixed mostly by Lead B (development) and Lead D (people). Full text: decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Product — UI audit (read-only)
<!-- merged-from: decisions/inbox/product-audit-ui.md -->
**By:** Product (audit role). tsc clean, 144 src/shared tests green; no Playwright (needs SQL).
**What:** 🔴 B1 transfer-battle UI missing (rivals, best-and-final invisible; `Hijacked` without warning). E2E CI blockers: Database specs hang on cache/prefetch (E1); transfer/loan specs ignore 50/85 (E2) — must filter by `/interest` and use `wageToAgree`. 🟠 offer form before desk loads; action success + failed refresh reports nothing; call-up requests/budget unrendered; "21th" ordinals; hard-coded Inbox "4"; mobile swipe leaves main nav; closed-stage badges green; Renew opens the offer page. 🟡 P1–P21: hard-coded table zones and "15:00" kickoffs, season label formats, US/UK spelling, plurals/locale, GBE points outside England, ClubSheet copy, capped Database paging, Career tab claims, fixture labels, club-transfer counts, PlayerHistory labels, interest badge, Office realism, SQL jargon, duplicate squad controls, accessibility, mobile risk, World search debounce.
**Why:** Whole-game sweep; G3–G6, P1–P9, P11, P16, P18 fixed by Product fix 2. Full text: decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Fact Checker — realism audit (small unrealisms)
<!-- merged-from: decisions/inbox/fact-checker-realism-audit.md -->
**By:** Fact Checker (requested by Carlos Sardo). Sources fetched 2026-09-26; FIFA RSTP and PL Handbook PDFs not extractable (those rows ⚠️).
**What:** ❌ README/REQUIREMENTS tier counts still describe world v3; contract end anchored to 30 June exceeds FIFA 3/5-year maxima; international loans > 1 year allowed; winter window should close 1 Feb 2027; Community Shield (16 Aug) and Franz Beckenbauer Supercup (22 Aug) must precede the league; per-league 2026/27 start/end dates; German winter break and 1 May; head-to-head / wins tiebreakers (ES, IT, FR-3, US); Ligue 3 3rd–6th play-offs; UCL league phase from 8 Sep. ⚠️ per-association windows, calendar-year leagues, MLS Round One best-of-three, Argentine promedios, Serie B play-off legs/play-out, emergency loans, FIFA 6/6 loan cap, squad-list/homegrown rules, `SQUAD_MINIMUMS` is really a target, German reserve cap, titleholder vacancy cascade, Eredivisie European play-off. ✅ FIFA windows, English/German/Dutch/Spanish/Italian/French pyramids, UEFA access, MLS format.
**Recommendation:** fix the ❌ items via per-league calendar metadata; update README/REQUIREMENTS. Most fixed by Lead A/B/C. Full text (sources): decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Fact Checker — youth national-team tournaments (research for Lead)
<!-- merged-from: decisions/inbox/fact-checker-youth-tournaments.md -->
**By:** Fact Checker (requested by Carlos Sardo). Read-only research.
**What:** Constants for UEFA U17 EURO (annual, 8, no ET, cohort Y−17), U19 EURO (annual, 8, ET, Y−19; even years feed the U-20 WC), U21 EURO (odd years, 16, cohort Y−23, qualifying in windows), FIFA U-17 WC (annual, 48, Qatar 2025–29, UEFA 11 places), U-20 WC (odd years, 24), other confederations' U17/U20 events, 2028 Olympics (12 teams, U23 + 3 overage). Release mandatory only inside FIFA windows ⚠️ (RSTP Annex 1 not retrievable); out-of-window youth finals and the Olympics are club decisions.
**DA:** stars skip youth squads (one team per window, prefer the oldest), refusals should cost morale, UEFA qualifiers are 3-game mini-tournaments, small reputation bumps only, simulate UEFA qualifying and resolve other confederations abstractly. Full text (tables, sources): decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Youth national teams and tournaments — design (Lead)
<!-- merged-from: decisions/inbox/lead-youth-internationals.md -->
**By:** Lead (requested by Carlos Sardo). Server implemented, uncommitted; calibrated to Fact Checker's brief. No schema change.
**What:**
- Five national teams per association (Senior, U21, U20, U19, U17); `ensureNationalTeams` back-fills U21 rows; `AgeGroup` gains "U21". Catalog `YOUTH_TOURNAMENTS` (shared/features/youth-internationals.ts); legacy youth league rows renamed in place.
- Qualifying simulated for UEFA only (U21 groups over the season before, U19 elite round in March, U17 in March); other confederations and World Cups take entrants by reputation. Deliberate deviations: U21 EURO 12–27 June, U19 EURO 2–14 July (rollover constraint).
- Duty (meta `internationalDuty`): squads named 4 days before fixtures, oldest team first, one squad per player; named players leave club lineups. Release mandatory in FIFA windows or 1 June–20 July, else a club decision by role (refusal −3 morale); the user follows `settings.youthRelease`.
- Effects: caps from `player_season_stats`, travel fitness, finals exposure `profile.international` (≤ 0.08 value multiplier, fades over 540 days). National-team suspensions now served by nationality.
- Cost: fast model + set-based batch; ~600–790 youth national matches per season.
**Open:** internationals.sql.test.ts NOT run; soak unmeasured; dual nationals, Olympics, U17→U19 League A/B link and RSTP Annex 1 not modelled. Full text: decisions-archive.md.

### 2026-09-26T21:30:00+02:00: Youth internationals — API contract (for Product)
<!-- merged-from: decisions/inbox/lead-youth-internationals-contract.md -->
**By:** Lead. Active contract; types additive in `shared/features/youth-internationals.ts`; all GET under the shared read lock.
**What:**
- `GET /api/internationals` → `InternationalsDesk { date, tournaments[] (held, edition, start, phase, championName), clubPlayers[] (selected | withheld), releasePolicy }`.
- `GET /api/internationals/teams/:id` → `NationalTeamView { team, duty | null, cutoff, players[] (selected | provisional | withheld, caps, goals), competitions[], fixtures[] }`; 404 if not a national team.
- `GET /api/players/:id/caps` → `PlayerCaps { teams[] (Senior first), total, exposure }`.
- Tables/fixtures/reports reuse competition routes (`/api/leagues?kind=international`); qualifying leagues are `<tournament> Qualifying`; CONMEBOL ends with a `Final round` group.
- `PATCH /api/settings { youthRelease: "club policy" | "always" | "mandatory only" }`. News: `Squad` items with `data.internationalDuty`; refusals `data.withheld`.
**Why:** Product's internationals UI (built in Product fix 2). Full text: decisions-archive.md.

### 2026-09-26T22:30:00+02:00: Match engine, competitions and calendar fixes (Lead, fix team A)
<!-- merged-from: decisions/inbox/leadA-match-comp-fixes.md -->
**By:** Lead A (requested by Carlos Sardo). Uncommitted.
**What:**
- `MATCH_RULES_VERSION` 4: laws gated on `rulesVersion >= 4`, stored v3 snapshots replay exactly. Penalties from ~1.4% of open-play chances, finishing offset −0.18, game-state shot factors, varied substitution plans (~4.25 subs), shorter stoppage, regulation-clock minutes, `snapshot.goalFactor` per league (`matchGoalFactor`, ⚠️ unconfirmed). Fast model mirrors v4 (cards/injuries/subs first, dismissal factors); `FAST_GOAL_RATE` 104, ratio 4.4.
- Cups: `cupEntryPlan` with `seededEntry` (FA Cup 8 rounds), rounds spread to `CupSpec.final`, open draws, `lowerTierHome` (⚠️). Byes precede winners; `Knockout round play-offs` stage; `isKnockoutStage` shared; Libertadores/Sudamericana two-leg ties straight to penalties.
- `LEAGUE_CALENDARS` 2026/27 (PL, LaLiga, Serie A, Bundesliga with winter break and 1 May, 2. BL/3. Liga, Eredivisie); Community Shield 16 Aug; Franz Beckenbauer Supercup 22 Aug; UCL from 09-08; fixtures reshuffled each season. Movement play-offs open per boundary. `LEAGUE_TIEBREAKERS` (H2H for ES/IT/FR-3, wins for US). Ligue 3 3rd–6th play-offs.
**Not done:** EFL Cup penalties, two-legged cup semis, other winter breaks, EFL through FIFA windows, CAF/CONCACAF away goals, UEFA league-phase criteria, DFB-Pokal amateur home rule. Full text: decisions-archive.md.

### 2026-09-26T22:30:00+02:00: Development model, engine attributes, discipline scopes, winter window (Lead, fix team B)
<!-- merged-from: decisions/inbox/leadB-sim-dev-fixes.md -->
**By:** Lead B (requested by Carlos Sardo, explicit permission to change things for realism). Uncommitted.
**What:**
- Pure `weeklyDevelopment` (server/growth.ts): growth ∝ gap × age curve × minutes share × environment × professionalism; decline from 29.5 slowed by professionalism/staff; GK age −2.5 and retire 3 years later.
- Potential centred on the population with age-scaled drift, `performance` and `minutesShare` inputs, noise and convergence from 21. Engine uses `currentAttributes(profile, ability)` (same as UI); attribute training every 4 weeks for every club; keepers train goalkeeping. Adult lifestyle re-drawn once between 18 and 22.
- `disciplineScope(league)` per competition; bans count down by `playing_club_id` + age group; legacy scopes deleted weekly. Knockout results no longer update tables. Gated debut keeper can replace an injured GK. Winter window closes 1 Feb (Monday 2 Feb if 31 Jan is a Saturday). Staff ability capped at ambition. Archived tables use `rankTable` tiebreakers.
- Probe (5,720 players, 14 seasons): players ≥ 85 0.42% → 0.80% (old 19.6%); p99 senior 87.1 (old 99); median peak 26 (GK 29).
**Open for others:** callups.ts `fixtureScope` must call shared `disciplineScope`; Office.tsx 31 Jan deadline and inline `ability − baseAbility` in PlayerSheet/queries → shared helpers; world.ts generation curve; SQL tests not run. Full text: decisions-archive.md.

### 2026-09-26T22:30:00+02:00: Transfer, loan, contract and finance fixes (Lead, fix team C)
<!-- merged-from: decisions/inbox/leadC-transfer-finance-fixes.md -->
**By:** Lead C (requested by Carlos Sardo). Uncommitted.
**What:**
- Loans priced by the parent (`loanAskingFee`); `loanTermsIssue` refuses split < 25%, sell-on > 50%, option below value, oversized bonuses, loans < 120 days; weekly bonus payouts clamped (closes the exploit in existing saves).
- FIFA: international loans ≤ one season, no international two-year/emergency loans, 6 in / 6 out and 3 per club pair for non-club-trained 22+ (⚠️ PDF). `contractEndDate` caps at 5 years (3 under 18). Options only in a window or the last month, wage must fit, player keeps wage and role.
- Wages on the buyer's scale (`marketWage(player, wageScale(buyer))`), no English floor; settled renewals ~1.1–1.2x; AI free agents respect 50/85. Flip margin narrowed (ceiling 1.06x, unsolicited bids 1.00–1.10x, none in a signing's first year, seller floors). FIFA training-compensation categories. Negative cash = transfer embargo. Rivals hand-over `LIKE '%"rivals":[[]{%'` + SQL test.
- Helpers delivered, NOT wired: `REVENUE_MARKET_FACTOR`, staff-free operating costs (upkeep cap is live), prize money, parachutes, `seasonBudgets` with unpaid instalments — must be wired by all callers together.
**Why:** Audit R1/R2 were free money and unplayable small-league renewals; FIFA RSTP art. 10 and 18.2 are hard limits. Full text: decisions-archive.md.

### 2026-09-26T22:30:00+02:00: People fixes — retirement, staff careers, spring notices, debuts, events, media (Lead, fix team D)
<!-- merged-from: decisions/inbox/leadD-people-fixes.md -->
**By:** Lead D (requested by Carlos Sardo). Uncommitted; no schema change.
**What:**
- `seniorRetirementChance`: ability-based onset, GK +3, contract years cut the chance, certain at 41 (GK 44); probe outfield mean 34.6, GK 36.7.
- 1 May spring notices (`processSquadNotices`): retirements at season end (meta `retirementNotice`), professional contract expiries across the family, staff contracts.
- Staff careers (`processStaffCareers`): birth year and ceiling, growth/decline, morale reverting, retirement 63–70, spread contract expiries, AI renew-or-replace, recycled free-pool people.
- Scouting knowledge fades unless recent; academy debut = age ≤ 21 with no senior appearance; 12 month/fixture-aware event kinds with no repeats; media headlines from the subject's side, roundup by group with deductions; starter affiliates only for tier ≤ 4 or reputation ≥ 55.
**Needs:** simulation.ts wiring (daily staff careers, drop the 4-weekly staff inflation, AI call-up rest days, family expiry news), youth.ts (use the new retirement chance, honour notices), world.ts ages 36–40, hide retired staff from hiring. Full text: decisions-archive.md.

### 2026-09-26T22:30:00+02:00: Data fixes wave 2 (audit 🟠/🟡 in Data-owned files)
<!-- merged-from: decisions/inbox/data-fixes-wave2.md -->
**By:** Data (requested by Carlos Sardo). No schema change; uncommitted.
**What:**
- Club transfers cache is incremental (`maxId`, clustered seek); `clubTransfersChanged` and bootstrap totals cleared on world replacement. Call-ups listed but excluded from season totals; `countIn/countOut` = external moves only, new optional `countInternal`, `countLoanEnds`.
- API (additive): `PlayerMove`/`ClubTransfer` gain `callUp?`, `callUpReturn?`, `until?` (present only when true).
- Nationality index batched (25k, `setImmediate`) and O(n). SQL pool 4 → 10 (GP_S_Gen5_2 allows 150 workers). Call-up `until` must be a real date within 120 days. International loans ≤ 365 days at enquiry and offer (`loanDurationError`; SCO/NIR/WAL separate); domestic 730.
- Not done: stripping rival truth from downloaded saves (would silently end running battles on re-import) — accept, or add an "export for sharing" option later.
**Open:** SQL tests need CI `all`. Full text: decisions-archive.md.

### 2026-09-26T22:30:00+02:00: Product (fix team 2) — internationals UI, call-up requests, audit polish
<!-- merged-from: decisions/inbox/product-fix2-internationals-ui.md -->
**By:** Product (requested by Carlos Sardo). Uncommitted.
**What:** Internationals is a sub-route `#competitions/internationals` with its own nav entry (swap to a `Page` value if game-context gains one). Table zones come only from each league's movement/championship rules (no continental zones stored). Fixtures show the weekday, not "15:00". PlayerSheet: one "Playing squad" + "Duration" control (`squad-move` or `call-up`). Club-sheet player links offer "Back to {club}" (src/sheet-trail.ts). e2e-bound strings kept on purpose: "favorites", "accent color", "B team", Database "N / M".
**Why:** Youth internationals and call-up contract items needed UI; audit items G3–G6, P1–P9, P11, P16, P18. Full text: decisions-archive.md.

## Archived summaries

Moved verbatim to decisions-archive.md on 2026-09-26T23:30:00+02:00 (search the heading there; the full-text entry sits nearby):
- 2026-09-22 – 09-23: account-release verification gate; new-career busy fix (contract and classic private world, platform limits, client deviations, code review, re-review); temporary Azure CLI subscription switch (user confirmation, autonomous decision).
- 2026-09-25 – 2026-09-26 11:30: world rebuild v4 — architecture and Phase 1 contract, verify.yml CI + Phase 0 Azure facts, catalogs (AFC, uefa-east, uefa-north, CAF, concacaf-ofc, conmebol, uefa-central A/B, uefa-west A/B), Lead-core catalog contract, Lead-systems row 11, Data row 13, Product row 12, Cloud ship runbook, Fact Checker catalog and continental verification, Coordinator rulings rounds 1–2, Rai PR #7 content-safety fixes, fast result model, CI rounds 7–12, invariants 6/7 after every rollover, real-club identity cores and rules, B-team movement, lazy SQL at startup, soak squad checks, club naming polish, shipping v4 while Carlos is away.
- 2026-09-26 12:20–12:58: async world jobs planning (Data, Fact Checker, Lead, Product, Cloud).
- 2026-09-26 20:30: "Call-ups inside the club family" and "Call-ups API contract" — superseded by the consolidated entries above.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
