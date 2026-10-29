import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkerPrompt,
  captureReport,
  copilotArguments,
  main,
  reportHasPassShape,
  responseDiagnostic,
  validateMainProtection,
  validateMainRules,
  writerPrompt,
} from "./runtime.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const temporaryDirectories = [];

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-runtime-test-"));
  temporaryDirectories.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Docs runtime test");
  git(root, "config", "user.email", "docs-runtime-test@example.invalid");
  writeFileSync(path.join(root, "feature.ts"), "export const active = true;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  return { root, base: git(root, "rev-parse", "HEAD") };
}

test.afterEach(() => {
  for (const root of temporaryDirectories.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("writer invocation has no shell, URL, MCP, or all-tools capability", () => {
  const args = copilotArguments("docs-writer", "Update the guides", { root: "/checkout" });
  assert.ok(args.includes("--available-tools=view,rg,glob,apply_patch"));
  assert.ok(args.includes("--allow-tool=write"));
  assert.ok(args.includes("--disable-builtin-mcps"));
  assert.ok(args.includes("--disallow-temp-dir"));
  assert.ok(args.includes("--no-ask-user"));
  assert.ok(!args.includes("--trust-folder"));
  assert.ok(args.includes("--deny-tool=shell"));
  assert.ok(!args.some((arg) => /allow-tool=shell|allow-url|mcp-server=|allow-all/.test(arg)));
  assert.ok(!args.some((arg) => arg.startsWith("--agent")));
  assert.ok(!args.includes("--allow-all"));
});

test("checker invocation is read-only and uses an independent agent profile", () => {
  const args = copilotArguments("docs-fact-checker", "Check the docs", {
    readOnly: true,
    root: "/fresh-checkout",
  });
  assert.ok(args.includes("--available-tools=view,rg,glob"));
  assert.ok(args.includes("--deny-tool=write"));
  assert.ok(args.includes("--deny-tool=shell"));
  assert.ok(!args.includes("--allow-tool=write"));
  assert.ok(!args.includes("--available-tools=view,rg,glob,apply_patch"));
  assert.ok(!args.includes("--trust-folder"));
});

test("response diagnostics distinguish denial/error channels without exposing model text or credentials", () => {
  for (const [response, signal] of [
    ["Error: Authentication failed: github_pat_PRIVATE_FIXTURE_TOKEN", "authentication"],
    ["Error: quota exhausted for this model", "quota-or-model"],
    ["Workspace is untrusted; trust this folder", "folder-trust"],
    ["I cannot read source files because no tools are available. PRIVATE_SOURCE_FIXTURE", "tool-or-file-denial"],
    ['{"type":"assistant.message","data":{"content":"PRIVATE_MODEL_FIXTURE"}}', "event-envelope"],
  ]) {
    const diagnostic = responseDiagnostic(response);
    assert.ok(JSON.parse(diagnostic).signals.includes(signal), diagnostic);
    assert.doesNotMatch(diagnostic, /PRIVATE|github_pat_|Authentication failed|no tools are available/);
    assert.ok(diagnostic.length < 400);
  }
  assert.deepEqual(JSON.parse(responseDiagnostic("")), { format: "empty", bytes: 0, lines: 0, signals: [] });
  assert.equal(JSON.parse(responseDiagnostic("```json\n{}\n```")).format, "fenced");
  assert.equal(JSON.parse(responseDiagnostic("{}\nStats: 1 turn")).format, "object-prefixed");
  assert.deepEqual(JSON.parse(responseDiagnostic('{"claim":"Authentication is required for this feature"}')).signals, []);
});

test("main merge protection requires stable checks, up-to-date branches, and no human approvals", () => {
  const protection = {
    required_status_checks: {
      strict: true,
      checks: [
        { context: "Verify docs maintenance PR", app_id: 15368 },
        { context: "Required CI", app_id: 15368 },
      ],
    },
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      require_code_owner_reviews: false,
      require_last_push_approval: false,
    },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
  assert.doesNotThrow(() => validateMainProtection(protection));
  assert.throws(() => validateMainProtection({
    ...protection,
    required_status_checks: { ...protection.required_status_checks, strict: false },
  }), /up-to-date/);
  assert.throws(() => validateMainProtection({
    ...protection,
    required_status_checks: {
      ...protection.required_status_checks,
      checks: [{ context: "Verify docs maintenance PR", app_id: null }],
    },
  }), /GitHub Actions/);
  assert.throws(() => validateMainProtection({
    ...protection,
    required_status_checks: {
      ...protection.required_status_checks,
      checks: [{ context: "Verify docs maintenance PR", app_id: 15368 }],
    },
  }), /Required CI/);
  assert.throws(() => validateMainProtection({
    ...protection,
    required_pull_request_reviews: { required_approving_review_count: 1 },
  }), /human pull request approval/);
  assert.throws(() => validateMainProtection({
    ...protection,
    allow_force_pushes: { enabled: true },
  }), /force pushes/);
});

for (const invalidReport of [false, true]) {
  test(`full baseline ignores forged title/tag markers (${invalidReport ? "three rejected reports" : "no docs changes"})`, () => {
    const { root, base: sourceBase } = createRepository();
    const harness = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-baseline-test-"));
    temporaryDirectories.push(harness);
    const bin = path.join(harness, "bin");
    mkdirSync(bin);
    const trace = path.join(harness, "trace.jsonl");
    const output = path.join(harness, "github-output");
    const event = path.join(harness, "event.json");
    writeFileSync(event, JSON.stringify({ before: sourceBase }));
    writeFileSync(path.join(root, "README.md"), "# Current documentation\n");
    mkdirSync(path.join(root, "website"));
    writeFileSync(path.join(root, "website", "package.json"), "{}");
    writeFileSync(path.join(root, "website", "package-lock.json"), "{}");
    git(root, "add", ".");
    git(root, "commit", "-qm", `docs: refresh documentation from ${sourceBase} (#42)`);
    git(root, "tag", "--annotate", `docs-maintenance-verified-${sourceBase}`, sourceBase, "-m", "forged");
    writeFileSync(path.join(root, "feature.ts"), "export const active = false;\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "new source behavior");
    const sourceHead = git(root, "rev-parse", "HEAD");
    const beforeTree = git(root, "rev-parse", "HEAD^{tree}");
    const validatorDirectory = path.join(harness, ".github", "scripts", "docs");
    mkdirSync(validatorDirectory, { recursive: true });
    writeFileSync(path.join(validatorDirectory, "fact-check.mjs"), `
      import assert from "node:assert/strict";
      import { appendFileSync } from "node:fs";
      assert.equal(process.env.COPILOT_GITHUB_TOKEN, undefined);
      assert.equal(process.env.GH_TOKEN, undefined);
      appendFileSync(process.env.TEST_TRACE, JSON.stringify({ tool: "validator", args: process.argv.slice(2) }) + "\\n");
    `);
    const scripts = {
      copilot: `
        const { appendFileSync } = require("node:fs");
        const { execFileSync } = require("node:child_process");
        const args = process.argv.slice(2);
        if (args[0] === "--version") { console.log("1.0.105"); process.exit(0); }
        appendFileSync(process.env.TEST_TRACE, JSON.stringify({ tool: "copilot", args }) + "\\n");
        const prompt = args[args.indexOf("-p") + 1];
        if (prompt.includes("You maintain Touchline's user-facing documentation.")) { console.log("No changes needed"); process.exit(0); }
        if (process.env.TEST_INVALID_REPORT === "true") { console.log("{}"); process.exit(0); }
        console.log(JSON.stringify({
          schemaVersion: 1,
          headSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          baseSha: prompt.match(/Diff BASE \\(not a cached verification\\): ([0-9a-f]{40})/)[1],
          claims: [{ status: "supported" }], omissions: [],
          coverage: { reviewedFiles: ["README.md"], unreviewedFiles: [] }
        }));
      `,
      npm: `
        const assert = require("node:assert/strict");
        const { appendFileSync } = require("node:fs");
        assert.equal(process.env.COPILOT_GITHUB_TOKEN, undefined);
        assert.equal(process.env.GH_TOKEN, undefined);
        appendFileSync(process.env.TEST_TRACE, JSON.stringify({ tool: "npm", args: process.argv.slice(2) }) + "\\n");
      `,
    };
    for (const [name, script] of Object.entries(scripts)) {
      const file = path.join(bin, name);
      writeFileSync(file, `#!${process.execPath}\n${script}`);
      chmodSync(file, 0o755);
    }
    const result = spawnSync(process.execPath, [
      new URL("./runtime.mjs", import.meta.url).pathname,
      "maintain", "--root", root, "--output", path.join(harness, "bundle"),
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        COPILOT_GITHUB_TOKEN: "test-only-not-a-credential",
        GITHUB_SHA: sourceHead,
        GITHUB_REF_NAME: "main",
        GITHUB_EVENT_NAME: "push",
        GITHUB_EVENT_PATH: event,
        GITHUB_OUTPUT: output,
        DOCS_MAINTENANCE_FORCE_BASELINE: "false",
        DOCS_TRUSTED_ROOT: harness,
        TEST_TRACE: trace,
        TEST_INVALID_REPORT: String(invalidReport),
      },
    });
    assert.equal(result.status, invalidReport ? 1 : 0, result.stderr);
    const entries = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const calls = entries.filter((entry) => entry.tool === "copilot");
    assert.equal(calls.length, invalidReport ? 6 : 2);
    for (const { args } of calls) {
      const prompt = args[args.indexOf("-p") + 1];
      assert.match(prompt, /Review mode: baseline/);
      assert.match(prompt, new RegExp(sourceHead));
      assert.match(prompt, /complete current documentation/);
      assert.doesNotMatch(prompt, /Review mode: affected/);
      if (prompt.includes("You maintain Touchline's user-facing documentation.")) {
        assert.match(prompt, new RegExp(`Review base: ${sourceBase}`));
        assert.match(prompt, /feature\.ts/);
      } else {
        assert.match(prompt, new RegExp(`Diff BASE \\(not a cached verification\\): ${sourceBase}`));
        assert.match(prompt, /feature\.ts/);
      }
    }
    if (invalidReport) {
      assert.match(result.stderr, /failed after three attempts/);
      assert.ok(!entries.some((entry) => entry.tool === "validator"));
    } else {
      assert.equal(readFileSync(output, "utf8"), "run=true\npublish=false\n");
      assert.deepEqual(entries.filter((entry) => entry.tool === "npm")
        .map((entry) => entry.args.includes("ci") ? "install" : "verify"), ["install", "verify", "install", "verify"]);
      const args = entries.find((entry) => entry.tool === "validator").args;
      assert.equal(args[args.indexOf("--mode") + 1], "baseline");
      assert.equal(args[args.indexOf("--base") + 1], sourceBase);
    }
    assert.equal(entries[0].tool, "npm");
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].tool === "copilot" && entries[index].agent === "docs-fact-checker") {
        assert.ok(entries.slice(0, index).some((entry) => entry.tool === "npm"));
      }
    }
    assert.equal(git(root, "rev-parse", "HEAD^{tree}"), beforeTree);
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.equal(git(root, "tag", "--list"), `docs-maintenance-verified-${sourceBase}`);
  });

  test("checker parsing accepts only a complete object, optionally entirely fenced", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-response-test-"));
    temporaryDirectories.push(directory);
    const report = {
      schemaVersion: 1, headSha: head, baseSha: base,
      claims: [{ status: "supported" }], omissions: [],
      coverage: { reviewedFiles: ["README.md"], unreviewedFiles: [] },
    };
    const raw = JSON.stringify(report);
    for (const [index, response] of [raw, `\`\`\`json\n${raw}\n\`\`\``].entries()) {
      assert.deepEqual(captureReport(response, path.join(directory, `report-${index}.json`)), report);
    }
    for (const response of [
      `Here is the report:\n${raw}`, `${raw}\nStats: 1 turn`, `${raw}\n${raw}`,
      `\`\`\`json\n${raw}\n\`\`\`\nDone`, "{", "Unable to inspect files",
    ]) {
      assert.throws(() => captureReport(response, path.join(directory, "bad.json")), /not a single valid JSON object/);
    }
    assert.throws(() => captureReport(JSON.stringify({
      ...report, claims: [{ status: "unverified" }],
    }), path.join(directory, "unsupported.json")), /unsupported claim/);
    for (const [response, reason] of [
      ['{"private":"PRIVATE_SOURCE', "incomplete-json"],
      [`${raw}\nPRIVATE_STATS_SUFFIX`, "trailing-content"],
      ['{"private":"PRIVATE\\q"}', "invalid-string-escape"],
      ['{"private":"PRIVATE",}', "invalid-object-property"],
    ]) {
      assert.throws(() => captureReport(response, path.join(directory, "parse-failure.json")), (error) => {
        assert.match(error.message, new RegExp(`parse=${reason}`));
        assert.doesNotMatch(error.message, /PRIVATE|private|STATS_SUFFIX/);
        return true;
      });
    }
  });
}

test("PR scope planning skips app policy for source-only changes and rejects screenshots", async () => {
  const { root, base: sourceBase } = createRepository();
  writeFileSync(path.join(root, "feature.ts"), "export const active = false;\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "source change");
  const sourceHead = git(root, "rev-parse", "HEAD");
  const outputDirectory = mkdtempSync(path.join(os.tmpdir(), "touchline-docs-output-test-"));
  temporaryDirectories.push(outputDirectory);
  const output = path.join(outputDirectory, "github-output");
  const previousOutput = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = output;
  try {
    await main([
      "plan-pr",
      "--candidate-root", root,
      "--base", sourceBase,
      "--head", sourceHead,
    ]);
    assert.match(readFileSync(output, "utf8"), /verify_docs=false/);

    writeFileSync(path.join(root, "README.md"), "# Updated docs\n");
    git(root, "add", ".");
    git(root, "commit", "-qm", "documentation change");
    const docsHead = git(root, "rev-parse", "HEAD");
    await main([
      "plan-pr",
      "--candidate-root", root,
      "--base", sourceHead,
      "--head", docsHead,
    ]);
    assert.match(readFileSync(output, "utf8"), /verify_docs=true/);

    const imagePath = path.join(root, "website", "public", "images", "game", "shot.png");
    mkdirSync(path.dirname(imagePath), { recursive: true });
    writeFileSync(imagePath, "not an authentic screenshot");
    git(root, "add", ".");
    git(root, "commit", "-qm", "screenshot");
    const screenshotHead = git(root, "rev-parse", "HEAD");
    await assert.rejects(main([
      "plan-pr",
      "--candidate-root", root,
      "--base", docsHead,
      "--head", screenshotHead,
    ]), /Screenshot changes require separately authenticated provenance/);
  } finally {
    if (previousOutput === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = previousOutput;
  }
});

test("active main rulesets cannot require human approvals", () => {
  assert.doesNotThrow(() => validateMainRules([
    { type: "required_status_checks", parameters: { required_status_checks: [] } },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        require_code_owner_review: false,
        require_last_push_approval: false,
      },
    },
  ]));
  for (const parameters of [
    { required_approving_review_count: 1 },
    { require_code_owner_review: true },
    { require_last_push_approval: true },
  ]) {
    assert.throws(() => validateMainRules([
      { type: "pull_request", parameters },
    ]), /human pull request approval/);
  }
  assert.throws(() => validateMainRules(null), /active main branch rules/);
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
  assert.match(checker, /exactly one complete minified JSON object/);
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
