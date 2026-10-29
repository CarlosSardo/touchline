import assert from "node:assert/strict";
import test from "node:test";
import {
  checkerPrompt,
  copilotArguments,
  reportHasPassShape,
  writerPrompt,
} from "./runtime.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);

test("writer invocation has no shell, URL, MCP, or all-tools capability", () => {
  const args = copilotArguments("docs-writer", "Update the guides", { root: "/checkout" });
  assert.ok(args.includes("--available-tools=read,search,edit"));
  assert.ok(args.includes("--allow-tool=write"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.ok(args.includes("--disallow-temp-dir"));
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(!args.some((arg) => /shell|url|mcp-server=|allow-all/.test(arg) && arg !== "--disable-builtin-mcps"));
  assert.ok(!args.includes("--allow-all"));
});

test("checker invocation is read-only and uses an independent agent profile", () => {
  const args = copilotArguments("docs-fact-checker", "Check the docs", {
    readOnly: true,
    root: "/fresh-checkout",
  });
  assert.ok(args.includes("--available-tools=read,search"));
  assert.ok(args.includes("--allow-tool=read,search"));
  assert.ok(!args.includes("--allow-tool=write"));
  assert.ok(!args.includes("--available-tools=read,search,edit"));
});

test("prompts pin exact revisions and enumerate changed files", () => {
  const writer = writerPrompt({
    sourceHead: head, reportBase: base, mode: "affected",
    changedPaths: ["server/transfers.ts", "src/transfer.test.ts"],
  });
  assert.match(writer, new RegExp(head));
  assert.match(writer, new RegExp(base));
  assert.match(writer, /server\/transfers\.ts/);
  assert.match(writer, /Do not execute commands/);

  const checker = checkerPrompt({
    head, base, mode: "baseline", changedPaths: ["README.md"],
  });
  assert.match(checker, new RegExp(head));
  assert.match(checker, new RegExp(base));
  assert.match(checker, /README\.md/);
  assert.match(checker, /exactly one JSON object/);
});

test("checker response must be current, complete, passing, and fully reviewed", () => {
  const valid = {
    schemaVersion: 1,
    headSha: head,
    baseSha: base,
    claims: [{ status: "supported" }],
    omissions: [],
    coverage: { reviewedFiles: ["README.md"], unreviewedFiles: [] },
  };
  assert.equal(reportHasPassShape(valid, head, base), valid);
  assert.throws(() => reportHasPassShape({ ...valid, headSha: base }, head, base), /incomplete or stale/);
  assert.throws(() => reportHasPassShape({
    ...valid, claims: [{ status: "unverified" }],
  }, head, base), /unsupported claim/);
  assert.throws(() => reportHasPassShape({
    ...valid, coverage: { ...valid.coverage, unreviewedFiles: ["README.md"] },
  }, head, base), /incomplete or stale/);
});
