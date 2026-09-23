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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
