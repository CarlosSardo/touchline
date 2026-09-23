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
