# Squad Decisions

## Active Decisions

### 2026-09-22T14:39:36.069Z: Proactive release progress updates
<!-- memory-id: 0473dd28-a22d-4674-b35c-c0c56b678c08 | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/carlos-sardo-via-squad-proactive-release-progress-updates-0473dd28.md -->
**By:** Carlos Sardo via Squad
**What:** User directive (Carlos Sardo, 2026-09-22): provide more proactive status updates in chat during ongoing work. Report concrete progress, current action, blockers and next gate at roughly 30-second intervals and after meaningful batches; do not leave long-running delegated work silent. User also authorizes a new feature PR for commit/push if required by branch policy. Existing approval to finish, commit, push and ship the per-user isolation feature remains active.
**Why:** User request — captured for team memory.

### 2026-09-22T15:58:10.063Z: Focused account-release verification gate
<!-- memory-id: 2459093d-50e9-4480-9679-e490b8d098bd | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-focused-account-release-verification-gate-2459093d.md -->
**By:** Squad Coordinator
**What:** 2026-09-22 release verification decision by Squad under Carlos Sardo's instruction to work autonomously while unavailable: use a focused incremental gate for the per-user isolation release. Required evidence: all 420 real SQL backend tests, production build/lint, five account UI tests with desktop/mobile inspection, repaired full-world checkpoint/save/UI/restore test, and focused existing career/account workflows. The known checkpoint busy-response race must be fixed and pass before production. Do not claim the full 38-scenario browser suite is certified; its initial run had 7 passed, one failed, 30 unrun. This is an autonomous scope decision, not a claim that the user explicitly waived a failing test.
**Why:** Autonomous scope decision made under Carlos Sardo's instruction to work autonomously while unavailable — captured for team memory.

### 2026-09-23T10:29:00+0200: User directive — new-career busy fix scope
<!-- memory-id: 34150fc2-7fc4-4506-acfd-607c762d55cc | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-new-career-busy-fix-classic-world-quick-fix-ship-when-verified-34150fc2.md -->
**By:** Carlos Sardo (via Squad)
**What:** New private careers get the CLASSIC world (160k players) instead of the expanded default (~834k). Build the QUICK fix only: a server "busy" answer no longer breaks the session; the app waits, shows that the world is still being built and reconnects on its own. The background-job world build and a retry-safe Start career were offered and NOT chosen for now. Ship to production once verified (user answered "Yes, ship when verified").
**Why:** User decision after the 2026-09-23 "Reconnect to account" regression on New career (PR #2) — captured for team memory.

### 2026-09-23T10:30:00+0200: New-career busy contract, /api/me and classic private world (Design Review)
<!-- memory-id: e381ad01-2928-463e-af5b-a2c2a3bc0982 | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/lead-new-career-busy-contract-api-me-and-classic-private-world-design-e381ad01.md -->
**By:** Lead (Design Review; inputs from Data and Product; Cloud diagnosis still pending)
**What:**
**A. Busy contract.** When a same-account request is refused because a mutation holds that account's router slot, the response is HTTP 409 with header `Retry-After: 2` and body `{ "error": "The game is saving or advancing. Please wait for that operation to finish.", "code": "world_busy", "operation": <WorldOperation>, "startedAt": "<ISO-8601 UTC>" }`. The error text is unchanged.
- Only 409 + `code: "world_busy"` is transient. Every other 409 stays a real error, e.g. saves.ts:639 and saves.ts:651.
- The router stores `activity: WorldActivity | null` instead of `busy` (app.ts:1061). `startedAt = new Date().toISOString()` when the slot is claimed (app.ts:1096). The signature becomes `mutation(operation, handler)`.
- Closed `WorldOperation` union in shared/api.ts:
  - prepare_world = POST /api/careers/prepare
  - start_career = POST /api/careers
  - load_career = POST /api/careers/load
  - delete_career = DELETE /api/careers
  - advance_days = POST /api/advance
  - create_save = POST /api/saves
  - restore_save = POST /api/saves/restore
  - export_save = GET /api/saves/export
  - import_save = POST /api/saves/import
  - expand_world = POST /api/world/expand
  - game_action = POST /api/action
  - update_settings = PATCH /api/settings
  - favorite_competition = PUT /api/competitions/:id/favorite
- Types: `WorldActivity { operation; startedAt }` and `WorldBusyResponse = { error; code: "world_busy" } & WorldActivity`.

**B. GET /api/me.** A plain handler in createWorldRouter, not wrapped in read() or mutation(). It has no busy gate, no store.transaction and no world applock, and it is not counted in `readers`.
- While the router's activity is set it returns 200 `{ user, hasWorld: null, activity }` and makes zero world-schema SQL calls.
- When idle it returns 200 `{ user, hasWorld: Boolean(await saves.currentState()), activity: null }` using one plain, non-transactional `store.get`. db.ts `all()` runs reads outside a transaction on a pooled request with no applock.
- `AccountSession = { user; hasWorld: boolean | null; activity: WorldActivity | null }`, with the invariant `hasWorld === null` if and only if `activity !== null`.
- Identity and isolation are unchanged. The EasyAuth checks and `Accounts.resolve` (accounts.users lookup and profile refresh, never the world schema) still run on every request (app.ts:978-986). Activity comes only from that account's `database:schema` router (app.ts:981). No global or cross-router state is added.
- A SQL failure on the idle path returns 500 as today.
- /api/bootstrap, /api/health/details and all other reads stay under read().
- The owner smoke check at scripts/azure-deploy.sh:288 must accept `hasWorld === null` only when an `activity` object is present.

**C. Classic world for new private careers.** Only saves.ts:653 changes: `generateWorld(this.store, { seed: `touchline-${randomUUID()}`, expanded: false })`, with no explicit counts.
- Result, verified from code:
  - every association, with 3 senior tiers plus U19/U17 (5 leagues each);
  - 120,000 seniors + 40,000 youth from WORLD_COUNTS (world.ts:1405-1406, shared/rules.ts:88-91);
  - no squad-minimum top-up, which is expanded-only (world.ts:1425; ensureClubRosters also runs only for expanded worlds);
  - club support is still added;
  - meta.world is `{ expanded: false, version: 1 }` (world.ts:1518).
- Classic worlds stay at version 1 under WORLD_VERSION 3, so World > Expand career world stays available (saves.ts:881-885). startCareer regeneration keeps the stored classic config (saves.ts:793 and saves.ts:813).
- This is the same class as the live unexpanded dbo world (repo notes: 243 associations, 1,215 leagues, 160k players). It is not byte-identical and doesn't need to be.
- Unchanged:
  - the buildWorldStructure default (world.ts:893-895), generateWorld, WORLD_VERSION and WORLD_COUNTS;
  - imports, saves and snapshots;
  - existing careers, including dbo;
  - the random prepare seed.
- Do NOT change: scripts/e2e-server.ts:39, server/check-world.ts:48 (world:check), scripts/db-seed.ts:76, server/check-simulation.ts:190, server/world-expansion.ts:58, or any generateWorld call in *.test.ts. The only test expectation that changes is app.test.ts:288, which adds `expanded: false`.

**D. Client quick fix (minimum).**
1. ApiError carries `code` and `retryAfter`. Busy means 409 + `world_busy`; there is no "any 409 is busy" fallback.
2. loadSession compares identity first; an account change still calls resetAccount as today. If /api/me has an activity, or bootstrap throws world_busy:
   - don't call resetAccount or setError;
   - keep the session, bootstrap and page, and expose `worldActivity`;
   - poll /api/me after 2, 4 and 8 s, then every 10 s (+0–1 s jitter), with no attempt cap, and keep polling while the tab is hidden;
   - once activity is null, run the normal load.
3. One poller per tab, in GameContext; the Start view reuses it.
4. Skip the focus/visibility recheck while any non-GET api() call from this tab is in flight, or while a busy poll is scheduled.
5. Startup while busy shows a non-fatal status: a spinner, role="status", no ErrorState and no Reconnect button.
   - prepare_world copy: "Your private world is still being built. This can take several minutes — Touchline will reconnect automatically."
   - Other operations: "Touchline is finishing another operation for your account and will reconnect automatically."
   - "Reconnect to account" appears only for real failures.
6. New career sends the prepare POST exactly once.
   - A 200 behaves as today.
   - On world_busy, 502/503/504 or a network error, keep the preparing overlay with the building copy and poll:
     - activity set → keep waiting;
     - idle and hasWorld → refresh, then open the club picker;
     - idle and no world → inline "Your private world was not finished. Try again." plus Retry preparation. Never re-send automatically.
   - Other errors show today's inline error.
7. Start career stays disabled until its outcome is known.
   - After world_busy, 502/503/504 or a network error, wait until idle, then refresh.
   - Success means `state.started && state.careerId !== careerIdBefore`; then go to the office.
   - Otherwise re-enable the button with an inline message. Never re-send automatically.
8. 401/403 and account-change handling stay unchanged, and they also stop the poller.
9. All other failures keep today's behaviour.
- Trimmed:
  - the /api/status endpoint and progress reporting;
  - a required elapsed-time display;
  - the 20-minute stop (an optional read-only "Check now" button is allowed);
  - pausing while hidden. After an ingress cut, the poll may be the only traffic keeping the 0..1 replica up; Cloud to confirm.

**E. Risk rules.**
- Make one supervised classic attempt in production. If it fails, stop and escalate to a background or resumable build; don't retry blindly.
- Carlos goes first; Eduardo only after Carlos succeeds.
- Don't deploy while a Touchline transaction is active, because the swap forces a rollback. Take a fresh, verified dbo backup first (--skip-db-prepare skips the export). Rollback is forward-fix only.
- Kiko: no data change.
  - Latent, pre-existing risk: New career then Start career on dbo regenerates the world within the request. If dbo's meta.world has no `expanded` field, saves.ts:793 (`countries >= 200`) chooses the expanded size.
  - Check this read-only; Kiko should hold off on New career until a background or retry-safe build exists.
- The snapshot at career start stays; changing it is out of scope.
- Pending on Cloud:
  - the cause of the 07:55Z replica replacement (OOM or probe kill = no-go);
  - the ingress timeout and scale-in cooldown;
  - READ_COMMITTED_SNAPSHOT (the idle /api/me read assumes ON);
  - storage and vCore headroom;
  - Carlos's schema state (if a prepared world exists, no build is needed).

**F. Verification gate.**
- Vitest on local SQL: server/app.test.ts and server/saves.test.ts green, with:
  - :206, :226 and :410 bodies updated to include `activity: null`;
  - :263 updated:
    - classic arguments;
    - owner /api/me returns 200 busy during the gated build;
    - bootstrap and a second prepare return 409 world_busy with operation, startedAt and Retry-After 2;
    - the guest account is unaffected;
  - :317 updated: update_settings, Retry-After and owner /api/me busy, with the guest unaffected;
  - one new spy case: no world-schema get/all/transaction on a busy /api/me, and no transaction when idle.
- One real-size classic prepare + start on local SQL with no generateWorld mock. Expect 160,000 players, version 1 and expanded false, and report durations.
- Playwright, run once over all of e2e/accounts.spec.ts, with typed busy-aware mocks and these new cases:
  - focus/visibility during a held prepare;
  - reload during prepare;
  - prepare 504 → picker;
  - 504, then idle with no world → Retry preparation;
  - Start career 504 → office, with exactly one POST;
  - guards for 500, 401 and account change.
- Run the new cases at 1440 and 390, and the busy startup screen at 320 with noOverflow.
- In the same run, game.spec.ts "startup waits…" plus a world_busy /api/me variant (mock user id "local") that asserts no .error-state ever appears.
- `npm run lint` (0 errors), `npm run build`, clean diagnostics and `bash -n scripts/azure-deploy.sh`.
- Not certified: the full 38-scenario browser suite, the full backend suite, a real classic build on Azure (the first supervised run is the acceptance test), and human OAuth.
**Why:** The user decisions are binding: classic world, quick fix, ship when verified. Root cause: an expanded world build inside one request holds the per-account busy slot for minutes, and PR #2's client treats that 409 as fatal. A machine-readable busy code keeps every other 409 an error. /api/me must stay answerable without touching the busy world. Limiting the server change to one generateWorld argument keeps existing worlds, saves, tools and tests untouched.

### 2026-09-23T10:30:00+0200: Platform limits the New-career busy fix must respect
<!-- merged-from: decisions/inbox/cloud-long-request-platform-limits.md -->
**By:** Cloud (Azure Cloud Specialist)
**What:**
1. Any HTTP request is cut by ACA ingress at 240 s (client sees 504; not configurable on Consumption) and by the EasyAuth sidecar at 600 s. Neither stops the server handler. The client must treat a 504/network error on `POST /api/careers/prepare` and `POST /api/advance` as "outcome unknown": keep polling `/api/me` until it stops answering busy, then reload state. Never resubmit automatically (the POST is not idempotent).
2. The KEDA HTTP trigger counts request arrivals, not work in flight. The replica is scaled to zero about 6–8 minutes after the last request, even mid-build. While busy, the client must keep polling (≤10–30 s is enough) and the UI must ask the user to keep the page open.
3. Keep `maxReplicas` at 1 while the busy flag lives in process memory.
4. Never deploy, change revisions/traffic or scale settings while any account operation is in flight. The deploy script's ingress close is not a writer drain.
5. The shared SQL Free database auto-pauses until the next calendar month if either the vCore-second or the 32 GB storage limit is reached. Used storage grew from 2.5 to 14.4 GB this morning through failed heavy operations. Avoid repeated production retries of world builds or long advances until the fix ships.
**Why:** Read-only diagnosis of the 2026-09-23 "Reconnect to account" incident: system events, sidecar logs, ACA and SQL metrics, and Microsoft Learn (ingress-overview, scale-app, health-probes, free-offer).

### 2026-09-23T12:05:00+0200: Client busy handling — two deviations from the Lead design, for review
<!-- merged-from: decisions/inbox/product-busy-client-contract-choices.md -->
**By:** Product
**What:**
1. 503 is NOT treated as "outcome unknown" on prepare/start/delete; only 409 world_busy, 502, 504 and network TypeError are. A server-originated 503 is a real refusal and keeps today's inline error + manual Retry (existing e2e case). Lead D6 listed 502/503/504.
2. Busy polling continues while the tab is hidden (Lead D trimmed "pausing while hidden"; Cloud: replica scales to zero ~6–8 min after the last request). The coordinator brief said "paused while hidden"; chose keep-alive because an ingress-cut prepare/start would otherwise lose its replica.
3. Delete of the active career is only offered when `state.started`; a prepared-but-unstarted world has no delete button (endpoint would accept it).
**Why:** Keeps every non-busy error a real error and avoids scale-in mid-build. Lead to confirm or reverse in review.

### 2026-09-23T12:50:00+0200: Code review — new-career busy fix + delete career (branch squad/new-career-busy-delete, uncommitted)
<!-- merged-from: decisions/inbox/lead-review-busy-delete.md -->
**By:** Lead (Reviewer)
**Verdict:** REJECT — one narrow blocking issue. Everything else is approved as-is.

**Blocking**
- B1. `DELETE /api/careers/active` can delete the legacy dbo world. `Saves.deleteActiveCareer` (server/saves.ts:705) and the route (server/app.ts:1511) have no dbo guard, and Start shows "Delete career" to any started career (src/views/Start.tsx:494). Kiko's router IS dbo, so one typed confirmation wipes the migrated live world and its snapshots. That breaks the contract ("Kiko: no data change") and the rule that the operator tool already enforces (scripts/career-delete.ts refuses dbo).
  - Fix: in `Saves.deleteActiveCareer`, before any read or lock, refuse when `this.store.schemaName.toLowerCase() === "dbo"` with a GameError, status **409**, `code: "career_protected"`, and a clear message.
  - Do NOT use 403: game-context.tsx:164 treats 403 as a session failure and resets the account.
  - Add one app.test case: a dbo-mapped account gets 409 career_protected, and its state, snapshots and counts are unchanged. The guest/peer isolation assertions stay.
  - Client: the existing generic branch already shows the message in the dialog. Hiding the button for dbo is optional (it needs a session flag, so it's not required now).
- Revision owner: **Product**. Data authored the server delete path and is locked out of this artifact. Product authored only the client, which is not rejected.

**Ship gate for the revision (in addition to the passing evidence below)**
- Focused local SQL run: server/app.test.ts + server/saves.test.ts.
- e2e/accounts.spec.ts delete cases.
- e2e/game.spec.ts "startup waits for a local engine…". It was never run for this change, and it exercises the unchanged 503 connect-retry path through the new loadSession.
- lint and build.

**Approved (verified)**
- Contract A/B/C conformance:
  - 409 world_busy with Retry-After 2 and operation/startedAt; other 409s stay real errors (career_mismatch has no Retry-After).
  - /api/me is ungated and makes zero world SQL while busy; one plain get when idle (spy-tested).
  - Classic prepare: only `expanded: false` changes, plus the justified removal of the save_slots/save_chunks emptiness check (saves.ts:648), so a new career can coexist with other careers' snapshots after a delete.
- Isolation:
  - All SQL goes through bindSql and the account schema.
  - Activity lives only in the per-account router.
  - The test sends a cross-account `schema`/`userId` body and it is ignored; the guest world and snapshots are byte-unchanged.
- Delete atomicity:
  - One Store.transaction with the applock.
  - TRUNCATE only for unreferenced tables where ALTER is held; otherwise range DELETE in reverse dependency order, and a self-referencing table is emptied in one statement.
  - Identity is reseeded; the appearanceIndexVersion marker is kept.
  - An injected failure after discard rolls back world, snapshots and chunks.
  - Snapshots are matched with a BIN2 exact comparison on career_id, and the seed must match.
- career-delete.ts:
  - dry-run by default; `--apply --yes` required;
  - exactly one oid or email, with exact case-insensitive matching and ambiguity refused;
  - refuses dbo; emails masked.
- Client:
  - prepare/start/delete POSTs are sent exactly once and never auto-resent;
  - outcome is decided from the reloaded state;
  - 401/403 and account-change handling are unchanged, and both stop the poller and settle waiters.
- Evidence post-dates the source edits: 119/119 local SQL; accounts e2e 26/26 at 1440/390/320. Lead reran lint (0 errors, known warnings), build and `bash -n` — all OK.

**Rulings on Product's open choices**
1. 503 stays a real error (not outcome-unknown): CONFIRMED. App-originated 503s and Envoy connect/reset 503s both mean the work did not commit. Retry is manual, prepare is safe to repeat (created:false/409), and a still-running start answers world_busy → wait.
2. Keep polling while hidden: CONFIRMED. Cloud's KEDA arrival-count evidence overrides the coordinator brief.
3. Delete only for a started career: CONFIRMED.
4. resetAccount after delete (the existing world-disappeared path), with the toast set after loadSession: CONFIRMED.

**Notes (non-blocking)**
- Deleting Carlos's career: use `career:delete` via azure-sql.sh with SQL_REQUEST_TIMEOUT_MS=900000, dry-run first.
  - If the MI lacks ALTER, every table falls back to logged DELETE in one transaction, which is heavy on the SQL Free log, vCore and storage.
  - Do it only when no Touchline request is in flight, and not during a deploy.
- A start/delete over 240 s is cut by ingress → the client waits (handled). Start career is measured at ~179 s locally, so Azure may exceed 240 s; the first supervised run remains the acceptance test.
- Pre-existing, out of scope: dbo New career → Start career regenerates the world at expanded size (saves.ts `countries >= 200`). Kiko should hold off.

**Why:** Reviewer gate — isolation and "never touch dbo" are hard requirements. The fix is ~10 lines and removes an irreversible one-click loss of the only migrated live world.

### 2026-09-23T13:00:00+0200: Re-review — busy fix + delete career (B1 revision by Product) + retro on the startup e2e failure
<!-- merged-from: decisions/inbox/lead-rereview-busy-delete.md -->
**By:** Lead (Reviewer)
**Verdict:** APPROVE the revision. Shipping is still gated on one test-only fix (A1 below).

**B1 — resolved (verified)**
- `Saves.deleteActiveCareer` (server/saves.ts:705–711) refuses the `dbo` schema (case-insensitive) with 409 `career_protected` before any read, lock or transaction.
- The route uses this method, so there is no bypass.
- server/app.test.ts:501 checks all of the following:
  - 409 with the exact body and no Retry-After;
  - spies prove zero `get/all/run/exec/transaction/discardWorld` calls;
  - state, slots, chunks, per-table counts and the guest world are unchanged.
- Negative check: with the guard disabled the test fails (500 instead of 409) — /tmp/product-rev-sql-negative.log.
- Evidence post-dates the edits:
  - saves.ts, app.test.ts and Start.tsx were last edited at 12:23; the SQL run (88/88) is from 12:25.
  - accounts.spec was last edited at 12:40; the e2e run (29/29) is from 12:42.
  - Lint: 0 errors and the 4 known warnings. Build OK.
- Client (Start.tsx:303–320): `career_protected` falls through to the generic dialog error. That is correct. It does not reset the account and does not auto-retry.

**Retro — e2e/game.spec.ts:1177 "startup waits for a local engine…" failed alone**

1. Facts
   - The run used a fresh isolated local schema (678 s total, 17.8 s for the test body).
   - The page reached Start with no `.error-state` and no Reconnect.
   - The snapshot shows "No career started" with the detail "Your private world is ready. Choose a club to begin.", which proves bootstrap loaded after the faked 503s.
   - The "Continue career" assertion failed.
2. Root cause — VERIFIED by code and history reading, not by a HEAD run:
   - HEAD renders "Continue career" only when `state?.started && club` (HEAD Start.tsx:288). The revision uses the same gate (Start.tsx:451).
   - A fresh e2e world is unstarted (world.ts:1485 `started: false`). scripts/e2e-server.ts, world.ts and playwright.config.ts are unchanged.
   - The gate was introduced in 1acda49 ("Isolate careers and profiles per authenticated user", PR #2). Before that commit, 1aaac24 rendered "Continue career" whenever a club existed. The test was never updated.
   - Product's hypothesis ("an earlier serial test starts the career") is **refuted**:
     - The only UI career start is at game.spec.ts:2850, which runs after 1177.
     - The only earlier calls that set `started` are the four `/api/advance` calls (617, 864, 949, 1021). All four sit in tests whose `finally` restores a pre-start checkpoint, and restore replaces the `meta.state`.
   - So the test fails deterministically at HEAD as well, both alone and in full-suite order. That full-suite claim is INFERRED from ordering; the suite was not run.
   - This is a pre-existing test-contract drift, not a regression from this branch. A HEAD worktree run would not add information, so it was skipped.
3. What should change
   - The test must assert what it is for: bootstrap loaded after 503 retries. It must not assert career state.
   - Reviewer gates that name an existing test must first confirm that the test's preconditions hold at HEAD.
4. Action items
   - **A1 (Product, blocks ship):** in game.spec.ts:1192, replace the "Continue career" assertion with an order-independent bootstrap-loaded marker, keeping `attempts > 2` and zero `.error-state`. For example: `page.getByRole("button", { name: "Continue career", exact: true }).or(page.getByText("Your private world is ready.", { exact: false }))`.
     - Negative check: fulfil every bootstrap call with 503, and the test must fail.
     - Rerun the single test on an isolated local schema.
   - **A2 (Lead):** before naming a test as a ship gate, trace its preconditions at HEAD.
   - **A3 (Product, non-blocking):** when an order dependency is suspected, grep the spec for the state-changing step and its position before reporting it.

**Why:** B1 closes the irreversible dbo wipe. The startup test covers the unchanged 503 connect-retry path through the new loadSession, which is the reason it was gated. It needs a correct assertion, not a waiver.

### 2026-09-23T13:41:00+0200: User confirmation — temporary Azure CLI subscription switch
<!-- memory-id: d5f28ecc-3fde-4255-aa3c-f37281db8989 | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-temporary-azure-cli-default-switch-approved-when-needed-d5f28ecc.md -->
**By:** Carlos Sardo (via Squad)
**What:** "if needed yes you can switch temporary." The team may temporarily switch the Azure CLI default subscription to Touchline (3373ab04-1dd1-49b2-8884-3094cfd0ca06) for release and production-operator steps, and must restore the saved original default (corporate tenant) afterwards.
**Why:** SQL operator logins use the CLI default tenant; confirms the coordinator's earlier release-window decision.

### 2026-09-23T13:45:00+0200: Autonomous decision — temporary Azure CLI default switch for the release
<!-- memory-id: 1f9c7b12-ccf8-416b-be37-488f76d1c85a | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-temporary-azure-cli-default-switch-for-the-release-window-1f9c7b12.md -->
**By:** Squad (Coordinator), acting autonomously because Carlos Sardo was unavailable and asked the team to "work autonomously and make good decisions".
**What:** The pre-release dbo backup failed ("server is not currently configured to accept this token") because the Azure CLI default account had moved to the corporate tenant (72f988bf…) and the SQL wrapper takes its token from the default tenant. Cloud may run `az account set --subscription 3373ab04-1dd1-49b2-8884-3094cfd0ca06` for the release window (backup, app-only deploy, and the user-requested deletion of carlos.sardo@outlook.com's career), after recording the original default subscription, and must restore that original default afterwards — immediately on any failure — and verify the restore. No re-login, no other CLI or tenant changes.
**Why:** Needed to complete the user's explicit instructions ("ship when verified", "delete my last created career"); local and reversible; the alternative (changing the SQL wrapper to honor the tenant) is a code change outside the approved release. Follow-up: make scripts/azure-sql.sh use the Touchline tenant explicitly so releases stop depending on the CLI default.

### 2026-09-23T13:55:00+0200: User directive — Azure CLI account
<!-- memory-id: 8f649cfb-0d12-4209-96ca-c105ce29c4e6 | class: DECISION | loadGuidance: ALWAYS | merged-from: decisions/inbox/squad-coordinator-azure-cli-must-use-carlos-sardo-outlook-com-for-touchline-8f649cfb.md -->
**By:** Carlos Sardo (via Squad)
**What:** Whenever Azure access is needed for Touchline, first switch the Azure CLI to the carlos.sardo@outlook.com account, subscription 3373ab04-1dd1-49b2-8884-3094cfd0ca06 (`az account set --subscription 3373ab04-1dd1-49b2-8884-3094cfd0ca06`), and verify with `az account show`. The machine default is casard@microsoft.com, which is the wrong account. Also: finish, deploy, commit and push the busy/delete fix; fan out work.
**Why:** User request — captured for team memory.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
