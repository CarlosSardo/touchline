import { createHash } from "node:crypto";

export const MAX_DAILY_PR_REVIEWS = 1;
export const VERDICT_FILE = "docs-verdict.json";
const WORKFLOW = ".github/workflows/docs-maintenance.yml";

export function verdictIdentity({ head, tree, base, policy }) {
  for (const [name, value] of Object.entries({ head, tree, base })) {
    if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error(`Invalid verdict ${name}`);
  }
  if (!/^[0-9a-f]{64}$/.test(policy ?? "")) throw new Error("Invalid trusted policy digest");
  return { head, tree, base, policy };
}

export function policyDigest(entries) {
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function verdictArtifactName(identity) {
  return `docs-verdict-${policyDigest(verdictIdentity(identity))}`;
}

export function validateVerdict(envelope, expected, run, repository, prNumber) {
  if (envelope?.schemaVersion !== 1 || envelope.repository !== repository ||
      envelope.prNumber !== prNumber || envelope.runId !== run.id ||
      envelope.runAttempt !== run.run_attempt ||
      run.status !== "completed" || run.conclusion !== "success" ||
      run.event !== "pull_request" || run.path !== WORKFLOW ||
      run.head_sha !== expected.head ||
      !run.pull_requests?.some((pr) => pr.number === prNumber &&
        pr.head?.sha === expected.head && pr.base?.sha === expected.base) ||
      JSON.stringify(verdictIdentity(envelope.identity ?? {})) !== JSON.stringify(verdictIdentity(expected))) {
    throw new Error("Cached verdict has no matching successful trusted workflow provenance");
  }
  if (!envelope.report || typeof envelope.report !== "object" || Array.isArray(envelope.report)) {
    throw new Error("Cached verdict is missing the independent report");
  }
  return envelope.report;
}

export function assertDailyReviewBudget(runs, { prNumber, now = new Date(), currentRunId, currentAttempt }) {
  if (!Array.isArray(runs) || runs.length >= 1000 ||
      ![prNumber, currentRunId, currentAttempt].every((value) => Number.isSafeInteger(value) && value > 0) ||
      runs.some((run) => !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) ||
        run.run_attempt < 1 || typeof run.run_started_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T/.test(run.run_started_at))) {
    throw new Error("Cannot establish a bounded daily documentation review budget");
  }
  const day = now.toISOString().slice(0, 10);
  const priorAttempts = runs.filter((run) =>
    run.event === "pull_request" && run.path === WORKFLOW &&
    run.run_started_at.slice(0, 10) === day &&
    run.pull_requests?.some((pr) => pr.number === prNumber))
    .reduce((sum, run) => sum + (run.id === currentRunId ?
      Math.max(0, currentAttempt - 1) : run.run_attempt), 0);
  if (priorAttempts >= MAX_DAILY_PR_REVIEWS) {
    throw new Error(`Documentation AI review daily cap reached for PR #${prNumber}: ${MAX_DAILY_PR_REVIEWS} starts per UTC day. Reuse requires an authenticated passing verdict; no new model call was made.`);
  }
  return priorAttempts;
}
