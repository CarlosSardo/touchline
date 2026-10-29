import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDailyReviewBudget, policyDigest, validateVerdict, verdictArtifactName,
} from "./review-cost.mjs";

const identity = { head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40), policy: "d".repeat(64) };
const run = {
  id: 12, run_attempt: 1, status: "completed", conclusion: "success",
  path: ".github/workflows/docs-maintenance.yml", event: "pull_request",
  head_sha: identity.head, created_at: "2026-10-29T00:01:00Z",
  run_started_at: "2026-10-29T00:01:00Z",
  pull_requests: [{ number: 35, head: { sha: identity.head }, base: { sha: identity.base } }],
};
const envelope = {
  schemaVersion: 1, repository: "owner/repo", prNumber: 35,
  runId: run.id, runAttempt: 1, identity, report: { claims: [] },
};

test("reuse binds independent report to exact successful workflow, revision, base and policy", () => {
  assert.deepEqual(validateVerdict(envelope, identity, run, "owner/repo", 35), envelope.report);
  for (const mutation of [
    { conclusion: "failure" }, { conclusion: "cancelled" }, { status: "in_progress" },
    { event: "workflow_dispatch" }, { path: "other.yml" }, { head_sha: "e".repeat(40) },
    { run_attempt: 2 }, { pull_requests: [] }, { id: 13 },
  ]) {
    assert.throws(() => validateVerdict(envelope, identity, { ...run, ...mutation }, "owner/repo", 35), /provenance/);
  }
  for (const key of ["head", "tree", "base", "policy"]) {
    const changed = { ...identity, [key]: "e".repeat(key === "policy" ? 64 : 40) };
    assert.throws(() => validateVerdict(envelope, changed, run, "owner/repo", 35), /provenance/);
    assert.notEqual(verdictArtifactName(identity), verdictArtifactName(changed));
  }
  assert.throws(() => validateVerdict({ ...envelope, report: null }, identity, run, "owner/repo", 35), /missing/);
  assert.throws(() => validateVerdict(envelope, identity, run, "attacker/repo", 35), /provenance/);
  assert.notEqual(policyDigest([["runtime", "old"]]), policyDigest([["runtime", "new"]]));
});

test("one conservative daily start includes failures, cancellations and rerun attempts", () => {
  const options = { prNumber: 35, now: new Date("2026-10-29T18:00:00Z"), currentRunId: 99, currentAttempt: 1 };
  assert.equal(assertDailyReviewBudget([], options), 0);
  assert.throws(() => assertDailyReviewBudget([{ ...run, conclusion: "failure" }], options), /cap reached/);
  assert.equal(assertDailyReviewBudget([{ ...run, id: 99 }], options), 0);
  assert.throws(() => assertDailyReviewBudget([{ ...run, id: 99, run_attempt: 2 }],
    { ...options, currentAttempt: 2 }), /cap reached/);
  assert.throws(() => assertDailyReviewBudget([{ ...run, run_attempt: 3 }], options), /cap reached/);
  assert.throws(() => assertDailyReviewBudget([
    run, { ...run, id: 13, conclusion: "cancelled" }, { ...run, id: 14, conclusion: "failure" },
  ], options), /cap reached/);
  assert.equal(assertDailyReviewBudget([{ ...run, run_started_at: "2026-10-28T23:59:59Z" }], options), 0);
  assert.throws(() => assertDailyReviewBudget([{
    ...run, created_at: "2026-10-01T00:00:00Z", run_attempt: 3,
  }], options), /cap reached/);
  assert.equal(assertDailyReviewBudget([{ ...run, pull_requests: [{ number: 36 }] }], options), 0);
  assert.throws(() => assertDailyReviewBudget(Array(1000).fill(run), options), /bounded/);
  assert.throws(() => assertDailyReviewBudget([], { ...options, currentAttempt: NaN }), /bounded/);
  assert.throws(() => assertDailyReviewBudget([{ ...run, run_attempt: undefined }], options), /bounded/);
});
