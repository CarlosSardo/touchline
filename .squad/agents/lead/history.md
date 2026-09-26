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

### 2026-09-26T21:30:00+02:00 — Audit: transfers, contracts, loans, finance (read-only)
- Report: .squad/decisions/inbox/lead-audit-transfers-finance.md. Top items: user-set loan terms are never priced (bonus/optionFee/sellOn/salarySplit → free money and free players); club-player wage expectation floors at the unscaled English `baseWage` (3–7x going rate outside rich leagues, 10–40x for amateurs).
- Economy probe pattern: planWorld + worldPlayers + worldStaff with estimateClubRevenue/weeklyOperatingCosts gives per-tier revenue/payroll/net in ~7 s for 15 nations. Catalog wage bills and the revenue formula are two independent calibrations; compare them per tier before touching either.
- `wage_budget` is written only at generation and by the budget slider; `transfer_budget` is reset to balance × 0.4 at every rollover (overwriting the promotion/relegation multiplier).

### 2026-09-26T21:30:00+02:00 — Audit: match engine, competitions, calendar (read-only)
- Findings in decisions/inbox/lead-audit-match-competitions.md. Top bugs: pendingByes appended (calendar.ts:2533) so top seeds meet in R2; discipline decrement by players.club_id (B-teams serve bans in parent matches; shared country:Senior:league scope); fast model subs dismissed players (~5.5% of matches).
- Engine probe (synthetic squads, /tmp/audit-match.ts): penalties 0.027/match (x>=84 foul gate unreachable except ST), 3.3 goals, 0-0 3.5%, minutes include stoppage (~104/match), 10 subs always at 60/72/82.
- Calibration reference is EPL 2023-25 only (3.11 goals): passing check-simulation does not mean world-realistic scoring.

### 2026-09-26T21:30:00+02:00 — Read-only audit: youth, growth, retirement, staff, registration (→ inbox lead-audit-youth-people.md)
- `growth.ts` is physical growth only; ability/potential development lives in simulation.ts `developPlayers` (weekly, all players) + shared/rules.ts `potentialInfluences`.
- Pure development probe = copy the weekly formula over `planWorld` + `worldPlayers` + `worldStaff` (7 nations ≈ 13 s for 12 seasons of 5.7k players). Found: potential +5/+3.6/+2.2 per season by age band (non-centred factors), ability at a fixed age rate to the cap, decline sped up by good staff.
- The full engine reads raw `profile.attributes` (asMatchPlayer) while the UI adds `ability − baseAbility`; the fast batch has no attributes (falls back to ability). Check engine/UI parity before trusting any attribute-driven balance.

### 2026-09-26T21:30:00+02:00 — Youth national teams and tournaments
- Much already existed: Senior/U20/U19/U17 national clubs (world.ts pass 4), generic FIFA U17/U20 + 12 confederation "U17/U19 Championship" specs, national matches picked on the fly by `country_id` (no squad, no club absence). Grep `type = 'national'` before designing "new" national features.
- Caps need no table: national matches already write `player_season_stats` with `club_id` = national team, which survives retention (per-match rows don't).
- Latent bug found: national suspensions were never served (decrement joined `players.club_id` = national id), so a national red card banned a player from that competition forever (scope `national:<league>` persists across seasons).
- Season rollover (1 July) forbids finals that straddle it: fixtures of season S after 1 July never play. Real U21/U19 EUROs straddle it; moved to 12–27 June / 2–14 July.
- A league row's `data` is reset by `createLeague` each season: anything carried across seasons (qualifying for next season's finals) must be read before `createLeague` runs.
- Club lineup exclusion without SQL cost: filter players on duty in JS and bump the batch TOP from 26 to 34 only on duty days; per-row OPENJSON exclusions inside CROSS APPLY are a plan risk.
- In a multi-replace batch I pasted the wrong oldString (a doc-comment opener instead of the function header) and clobbered it; a grep for the function name showed two copies. Re-grep the anchor after every batch edit.
- SQL unavailable again (14330 closed, no Docker): internationals.sql.test.ts written and type-checked only.

### 2026-09-26T22:30:00+02:00 — Fix team D: retirement, staff careers, spring notices, debuts, events, media
- Retirement lives in youth.ts (`retirementChance`), not retention.ts (retention only prunes leavers). New rule is `seniorRetirementChance` in people.ts; youth.ts must switch to it (call-site change handed back). Contracted seniors at the 1 July rollover still hold contracts ending 30 June (expiry runs after the rollover that day), so `contractYearsLeft` = 0 there.
- Pure probes under /tmp cannot resolve bare packages: import `node_modules/.../index.js` by absolute path, or put the probe inside the repo.
- Staff have no age/contract columns: `staff.data` (birthYear, ceiling, contractEnd, retired) is enough; generation gave every staff contract 2029-06-30, so spread them before anything expires.
- Hosting a once-a-year notice inside an already-daily function I own (`processCompetitionNotifications`) avoids a simulation.ts call site; replacing existing behaviour (the 4-weekly staff UPDATE) cannot.

### 2026-09-26T22:30:00+02:00 — Fix team C: loan pricing, buyer-scaled wages, FIFA contract/loan caps, finance helpers
- `signClublessPlayers` lives in youth.ts, not simulation.ts (the spawn prompt said simulation.ts); edited only that function after checking mtime.
- `wageScale` clamps to 4 when a club has no professional base wages (all-amateur squads): any going-rate formula then prices a pro at 4x the English base. Guard with a minimum scale (`clubPayrollScale`).
- A national revenue factor must be passed by every revenue caller at once (weeklyFinances x2, world.ts initialClubFinances, projectedOperatingRevenue), else projections and accounts disagree; I added the input but left projectedOperatingRevenue unwired. Fade the factor out below tier 2: lower-tier catalog wage bills are already local-scale (PT-T3 went to 116% wages/revenue at a flat factor).
- Loan pricing via ratio re-pricing of `asking_price` when terms change keeps the declare-interest premium and makes the counter consistent; SQL loan tests that bid exactly `asking_price` with a sub-reference split must bid above it.
- Shared terminal output is interleaved with other agents; read_file of /tmp logs sometimes 404s until a fresh name/list_dir. Write snapshot files via a script and read those.
- SQL unavailable (not attempted; same environment): systems/transfer-battles SQL tests updated and type-checked only.

### 2026-09-26T22:30:00+02:00 — Fix team A: match engine v4, cups, brackets, calendars, tiebreakers
- New engine laws need a rules version and zero extra random draws on the old path (gate every `random()` behind `v4`), or stored v3 snapshots stop replaying. Verify by importing the HEAD engine (`git show HEAD:… | sed` imports to absolute paths) and diffing results.
- Stage names are load-bearing: simulation.ts decides `decisive` from a stage whitelist (`startsWith("Round of")`). A new stage name ("Knockout round play-offs") without the call-site change leaves ties undecided and progressCompetitions throws. Domestic cup rounds therefore keep `Round of N` (N = clubs in the round).
- A cup with late-entering tiers is a Kraft equality: sum of 2^(entry-1) = 2^rounds guarantees an even field every round; the FA Cup needs one extra round (8) for PL + Championship to join in round 3.
- Game-state shot factors raise draws but barely move 0-0 or 5+ shares; engine totals stay Poisson-like, so 0-0 ~7-8% with 5+ ~10% needs a mean near 2.6 (LaLiga-like), not the pooled 2.75.
- Top flights ending 22–30 May made the "every tier finished" gate delay EFL/Segunda play-offs into June: open movement play-offs per boundary (promotion needs only the lower table).
- Never type into the shared terminal while others run jobs: my command interrupted another agent's Playwright run (exit 130). Launch everything via setsid scripts.

### 2026-09-26T22:30:00+02:00 — Fix team B: development model, engine attributes, discipline scopes, winter window
- Development is now pure (`weeklyDevelopment` in growth.ts) with centred `potentialInfluences`; decision in inbox leadB-sim-dev-fixes.md. Probe gate /tmp/leadB-dev-probe.mts (old|new).
- A 1/7 probe sample breaks squad-rank rules: "top 11 play" made every sampled youth a starter and faked +0.9 potential/season. Rank by share of the sampled squad.
- The stable-elite gate depends on the release rule: keeping graduates globally by keepScore inflates (≥85 ×6), per club (tier-8 graduates stay tier-8) is realistic (≥85 0.42% → 0.80%). world.ts youth/senior discontinuity (18: 34, 19: 52, flat seniors) caps what any realistic curve can match.
- `read_file` returned stale content for /tmp logs rewritten in place; copy to a new name (or unique TAG per run) before reading.
- `worldPlayers(plan)` returns an iterator (Node 22 iterator helpers give it `.map` without `.length`): spread it first.
- Changing a shared date rule (winter deadline) touches other owners' tests (transfer-battles windowPhase, already updated for 1 Feb this time); grep all tests for the old literal before finishing.

## Summarized (2026-09-26)
Condensed by Scribe on 2026-09-26T23:30:00+02:00 from 8 detailed entries and 4 team updates (2026-09-23T12:50 – 2026-09-26T21:00); the later entries above stay verbatim.
- 2026-09-23T12:50 review of busy fix + delete career → REJECT: a destructive-operation guard (refuse dbo) must live in the domain layer (Saves) on every path, not only the CLI; guard errors use 409 + a code, never 401/403 (the client treats those as a session failure).
- 2026-09-23T13:00 re-review → APPROVE: before gating on an existing test, trace its preconditions at HEAD and git-log the asserted UI (the startup e2e was already broken by 1acda49).
- 2026-09-23T13:56 team update: PR #3 (e80e867) shipped the busy fix + delete career (409 world_busy, ungated /api/me, classic world, dbo refused with 409 career_protected).
- 2026-09-24T09:22 PR #6 review: approved the exact commit after independent test counts; GitHub refuses self-approval of the owner's PR, so the Squad reviewer verdict is the merge gate.
- 2026-09-26T18:36 interest refusal + negotiation value fixes: negotiation logic is systems.ts (recruitment.ts only scores); buyer-managed talks run daily via processNegotiations → negotiate(automated), where a GameError closes the deal Rejected. Fixed: counter persisted as asking price, zero-fee budget bypass, ignored agent commission, ceiling ignoring the bidder's own bid. Extract pure helpers so fixes have runnable tests when SQL is down. read_file caches /tmp logs by path: use fresh names.
- 2026-09-26T18:36 team update: Product's `useCurrency().text()` converts £ amounts in server text; new server messages should carry structured amounts.
- 2026-09-26T19:00 50/85 thresholds: check `git diff` + mtimes before re-implementing in a shared worktree; calibrate with pure probes (86%/95% find a buyer; AI wages ~1.45–1.50x); pin SQL fixtures (keen/unwilling) instead of relying on random interest; /tmp probes need absolute node_modules imports.
- 2026-09-26T20:05 transfer battles wired: `processTransferBattles` runs after processNegotiations and before worldTransfers; AI completions need window/club/cap checks; pure `battleWinner`/`windowPhase` tests; SQL tests in `*.sql.test.ts` behind skipIf (the CI detector greps for `Store`); daily TOP (40) bound; fog relies on Data's `withBattleViews`/`withRivals`.
- 2026-09-26T20:30 call-ups (coach layer): re-run checks before "fixing" reported integration errors; a team is `(squad_club_id ?? club_id, age_group)`, so a call-up is the existing squad move plus meta `callUps` bookkeeping (meta has no save whitelist → no F0 blocker); fast-model effects stay set-based (pre-rolled per side, one extra CROSS APPLY TOP (8)); leaner AI matchday minimum (14) was the right knob; roll merit once per fixture; pure test files must not contain `Store`.
- 2026-09-26T21:00 team updates: Fact Checker's call-up realism brief is the calibration source for CALL_UP_RULES; Data wired `withBattleViews`/`withRivals`; migration 7 stays reserved for world_jobs, features use 8 and 9.
- 2026-09-26T21:00 call-up calibration: Scribe may merge an inbox file mid-task, so a follow-up is a new inbox delta; match-v3 totals goals only at full time (read `result.stats[teamId].goals` in-match); `worldPlayers(plan)` rows have no id; U19 matchday need (14) mattered more than merit chances; rotate deterministic AI picks by the passing roll; settle the debut budget on appearance. Probe: coach inside every band, AI slightly low for bottom top flight and tier 3+.
📌 Team update (2026-09-26T23:30:00+02:00): Data wave 2 added `loanDurationError`/`MAX_LOAN_DAYS` in app.ts (international loans ≤ 365 days at enquiry/offer); reuse or move them to shared/rules.ts if systems.ts enforces the rule for AI loans — decided by Data
📌 Team update (2026-09-26T23:30:00+02:00): Open wiring across fix teams — Lead D needs simulation.ts (daily `processStaffCareers`, drop the 4-weekly staff UPDATE, AI call-up rest days, family expiry news) and youth.ts (`seniorRetirementChance`, honour `retirementNotice`); Lead C's revenue/prize/parachute/`seasonBudgets` helpers are unwired; callups.ts `fixtureScope` must call shared `disciplineScope`. No SQL test has run; CI verify `all` is the next gate — decided by Lead A–D, Scribe
- Integration 2026-09-26 (lead-integration.md): world veterans must keep ratings drawn at the slot age — createIdentity's nationality-switch loop `break`s on an ability-dependent roll, so changing ability shifts the whole `:players` stream; only move the birth year (same draw count).
- Rollover economy runs in TS over one grouped query + `updateSimulationRows` (seasonBudgets/prize money), not per-club UPDATEs; movement factor travels as `clubs.data.budgetMovement` to the single budget reset.
- The pure youth population projection releases 31+ veterans before they retire, so per-season "retired > 0" fails under the later people.ts onset; assert outflow per season and retirements overall.
