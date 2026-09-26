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

### 2026-09-26T18:36:37+02:00 — Negotiation UI values & rejections (squad/world-rebuild-2, uncommitted)
- Server negotiation/interest text is written with rules.money() = GBP ("£1.2M"), while inputs/labels use the career currency. `useCurrency().text()` (src/money-text.ts `localizeMoneyText`) converts those amounts; act() toasts, negotiation log/latest and interest factor reasons use it. Structured values (data.counter, data.requiredWage, asking_price) are preferred where available.
- OfferPage finds the deal by `selected` id else by ACTIVE stage; a deal that turns Rejected dropped out and the page silently reset to "Make an offer". NegotiationSheet now calls `onAction` before requesting a response so the page pins the id; closed deals show "Start new talks", and the fresh form shows the latest closed talks' last message.
- act() returns `stage: "Rejected"` only for counterpart decisions (director's own reject returns no stage) → toast tone error. Desk modal no longer auto-closes on Rejected.
- `.then(close)` after act() closes even on failure (act swallows errors and returns undefined): always `.then((r) => { if (r) close(); })`.
- Server rule seen (Lead's domain): at Agent talks a low-interest player (score < 35) only returns "not ready to agree" and never Rejected unless tension ≥ 90; at Club talks only interest < 20 rejects.
- 2026-09-26T18:36:37+02:00 follow-up: InterestSummary shows "Not interested — will reject" when `interest.refuses === true` (optional; moveScore shown if present). Outgoing Club talks show `details.counter` as "Club counter-offer" beside the unchanged asking price; `data.counter` is shared with the incoming-offer "Buyer's maximum fee", so gate on stage.

📌 Team update (2026-09-26T18:36:37+02:00): Lead changed that rule — `PlayerInterest` now has optional `moveScore` (score without the wage factor) and `refuses` (moveScore < 25). A refusing player's stance is always "Not interested" and personal terms close as `Rejected` with the reason in history (also for players the user sells). Club talks counter no longer lowers `asking_price`; the counter is in `data.counter`. Surface `refuses` in InterestSummary and show the stored counter. — decided by Lead

### 2026-09-26T19:30:00+02:00 — Interest 50/85 badge + Player History tab (squad/world-rebuild-2, uncommitted)
- InterestSummary states come from src/interest-state.ts `interestState()`: thresholds from `PlayerInterest.thresholds` else INTEREST_BANDS (refuse 50 / agree 85); refuse = `refuses` or moveScore (fallback score) < negotiate; agree = score >= agree. Summary shows `wageToAgree` via money() (GBP in, career currency out); null = "no wage within the cap is enough".
- PlayerSheet "History" tab → src/PlayerHistory.tsx (+PlayerHistory.css imported from the component, pure helpers in src/player-history.ts) over `GET /api/players/:id/history`. Server nulls (goals/assists/averageRating when recordedAppearances = 0, fee null) render "—"; partial coverage shows "N of M" and a title. Competition filter is client-side; totals re-weighted by recordedAppearances.
- No e2e/history.spec.ts yet (Playwright needs SQL) — gap.

### 2026-09-26T20:00:00+02:00 — Player Database perf (squad/world-rebuild-2, uncommitted)
- useResource gained `cache` (module LRU of 24, key = accountGeneration:revision:path, cleared in resetAccount) and `prefetch` (idle warm of one path only when the current response took ≤ 800 ms; in-flight prefetch is reused by the real fetch). Database uses both for the next page; typed number/money/search inputs debounce 300 ms (src/resource-cache.ts createDebouncer), selects/chips/reset apply at once; stale rows dim (`.database-results.is-stale`) instead of unmounting; optional `totalCapped` renders "10K+". loadSession now sends /me and /bootstrap together and drops the verification /me (same cookie on both). Gotcha: oxlint flags setState in an effect — sync cache hits during render instead.

### 2026-09-26T20:00:00+02:00 — Club Transfers tab (squad/world-rebuild-2, uncommitted)
- ClubSheet "Transfers" tab (non-national clubs) → src/ClubTransfers.tsx (+ClubTransfers.css, pure helpers src/club-transfers.ts + test) over `GET /api/clubs/:id/transfers`; filter {season,direction,type,page} in one state object, any non-page change resets page 1, useResource keepPreviousData + aria-busy dimming. Groups come pre-grouped from the server; "All" direction splits Arrivals/Departures per season, a direction filter renders one table (a direction column would be constant, so it is omitted). Fee: 0 → "Free", null on fee kinds → "Undisclosed", returns/recalls/internal moves → "—". Kind labels reuse MOVE_KIND_LABELS. `<ClubTransfers key={club.id}>` so filters reset when a club link inside the tab switches the sheet.

📌 Team update (2026-09-26T21:00:00+02:00): Call-ups API contract is in decisions.md (GET /api/call-ups → CallUpDesk; actions call-up / call-up-end / call-up-proposal; PATCH settings autoCallUps); collapse call-up + return history pairs in PlayerHistory/ClubTransfers — decided by Lead
📌 Team update (2026-09-26T21:00:00+02:00): Render only battle view fields (`negotiation.battle`, `RivalInterest[]`), never `data.rivals`/`data.battle`; Database shows "10,000+" when `PlayerPage.totalCapped` — decided by Lead, Data

### 2026-09-26T21:00:00+02:00 — Call-ups UI (squad/world-rebuild-2, uncommitted)
- Squad view "Call-ups" tab → src/CallUps.tsx `CallUpsPanel` over `GET /api/call-ups` (keepPreviousData): debut budget badges, "Coach call-ups" Toggle mirroring `bootstrap.settings.autoCallUps` (fallback desk.autoCallUps) via changeSettings, coach proposals Accept/Decline, active call-ups grouped by target team with "Send back now". `CallUpDialog` (squad rows ArrowUpDown button + PlayerSheet "Move up / down") lists eligible `squadDestinations` with ↑/↓/↩ direction, duration Next match/Days/Until/Permanent; client validation inline, server refusals via act() red toast, dialog stays open on failure. Pure helpers + tests in src/callups.ts. History collapse (`collapseCallUps`, "Called up to U19 · 3–10 Oct") is wired in PlayerHistory/ClubTransfers but DORMANT: server/player-history.ts + club-transfers.ts do not forward `callUp`/`callUpReturn`/`until` yet (gap for Lead/Data).

### 2026-09-26T21:30:00+02:00 — UI audit (read-only) → decisions/inbox/product-audit-ui.md
- Biggest gap: transfer battles (`negotiation.battle`, `rivals`) have NO client UI; CallUpDesk.requests / `call-up-development` also unrendered.
- useResource `cache`+`prefetch` makes `page.waitForResponse` e2e helpers hang on revisited/prefetched pages; compare DOM with `request.get` instead.
- e2e transfer/loan targets must be filtered by `/players/:id/interest` (moveScore ≥ 50, `wageToAgree`) since the 50/85 bands.
- Gotcha: setsid background jobs from the shared terminal died silently (empty log); sync runs with output redirected to /tmp logs worked.
### 2026-09-26T22:30:00+02:00 — Fix team 1: RivalPanel (src/RivalPanel.tsx) in NegotiationSheet/offer page, desk-gated offer form, closed-stage red badges, "Renew contract" title, act() keeps success when refresh fails (warning toast, no account reset), server ISO dates localized via `text()` (money-text `localizeServerText`); e2e: `databaseQuery` compares with API, `willingTargets`/`agreeableWage` helpers; new mocked e2e/transfer-battles.spec.ts. Note: club-talks rejection uses `negotiation.interest` = overall score (not moveScore), so filter on both. setsid does work — the shell just reports "Done" as setsid forks; check with pgrep.
### 2026-09-26T22:30:00+02:00 — Fix team 2: Internationals view (#competitions/internationals sub-route, NationalTeam.tsx sheet/panel, caps on PlayerSheet, duty badges in squad), call-up development requests + played/pending debuts, rules-based table zones (table-zones.ts), no fake 15:00, ordinals/plurals/seasonText (format.ts), club-sheet "Back to" trail (sheet-trail.ts), merged PlayerSheet squad move+duration, a11y regions on scroll tables, docs to world v4 (211 assoc, 1–6 tiers). Gotcha: src may not import shared/world-catalog even as types (import-boundary test) — copy minimal shapes. e2e pins "favorites", "accent color", "B team", "N / M" page text.
### 2026-09-26T23:30:00+02:00 — Fix 3: accounts.spec mocks `GET /api/news` (Shell's unread badge fires on every shell mount, even with no world) → 32/32; parallel /me+/bootstrap needed no fixture change (reads use arrayContaining/counts). plural() for "N days advanced"/"N matches", contract/buy-back/instalment years; "Modelled". Office deadline = shared `winterWindowClose`; PlayerSheet attributes = shared `currentAttributes`. Gotcha: in this shared terminal read_file lags on fresh /tmp files (retry once) and the tool strips a leading `cd …&&` — use absolute paths.

## Summarized (2026-09-26)
Condensed by Scribe on 2026-09-26T23:30:00+02:00 from 7 detailed entries and 2 team updates (2026-09-23T09:15 – 2026-09-24T09:22); the later entries above stay verbatim.
- 2026-09-23T09:15 team update: account-release verification gate (busy-response race must pass; browser suite not certified).
- 2026-09-23T09:41 "Reconnect to account" dead end: the server busy gate 409s every read during a mutation, so the client must treat 409 `world_busy` as transient and never reset the account on any loadSession failure; mocked fixtures must mirror the gate and fire focus/visibility events mid-mutation.
- 2026-09-23T12:05 busy-safe client: one poller per tab (`touchline:world-busy`, 2/4/8/10 s + jitter, runs while hidden); recheck skipped while a non-GET is in flight; prepare/start/delete sent once, 502/504/TypeError/world_busy = outcome unknown → waitForIdle + reload; 503 stays a real error. accounts.spec runs mocked against bare vite.
- 2026-09-23T12:50 dbo guard revision: `Saves.deleteActiveCareer` refuses dbo (409 career_protected); e2e `noOverflow()`/`expectNoFatalScreen()` assert zero `.error-state`, so tests expecting an inline error must check it directly.
- 2026-09-23T13:15 startup-retry e2e: "Continue career" needs a started career (not an order dependency); reuse one seeded world via `npm run test:local` + TEST_URL; drop `reseed_world_identity` before the schema.
- 2026-09-23T13:56 team update: PR #3 (e80e867) shipped the busy-safe client and Start screen revamp.
- 2026-09-23T14:05 Rai finding: `??` does not catch "" — use `x?.trim() || fallback` for text that gates a destructive action and require a non-empty target. Shared terminal output can show other agents' lines: write output + END marker to /tmp logs.
- 2026-09-24T09:22 VS Code test discovery (vitest.explorer + Playwright extensions; 304 Vitest / 65 Playwright tests) and PR #6 (6f8efc8, merged as 38cf810) packaged from an isolated worktree.
📌 Team update (2026-09-26T23:30:00+02:00): Data now forwards `callUp`/`callUpReturn`/`until` on `PlayerMove` and `ClubTransfer` (only when true), so `collapseCallUps` is live; club totals `countIn/countOut` are external moves only, with optional `countInternal` and `countLoanEnds` — decided by Data
- 2026-09-26T23:59 loan form limits: salarySplit slider 25-100 (server MIN_LOAN_SALARY_SPLIT), sell-on 0-50 (MAX_LOAN_SELL_ON), limits shown in labels; initial terms pass through `withLoanLimits` (invalid/<25 -> 70, server already sends 70 or partnership-lowered). Constants mirrored locally in Transfers.tsx (src cannot import server/). Start "N saved career(s)" via plural().
