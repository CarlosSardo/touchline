import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { policyDigest, verdictArtifactName } from "./review-cost.mjs";

for (const mode of ["cached", "fresh", "cap", "bad-provenance", "build-failure"]) {
  test(`PR review subprocess integration: ${mode}`, (t) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "touchline-cost-runtime-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const root = path.join(directory, "candidate");
    const trusted = path.join(directory, "trusted");
    const bin = path.join(directory, "bin");
    for (const name of [root, trusted, bin]) mkdirSync(name);
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    const put = (name, value) => {
      mkdirSync(path.dirname(name), { recursive: true });
      writeFileSync(name, value);
    };
    git("init", "-q");
    git("config", "user.name", "Cost fixture");
    git("config", "user.email", "fixture@example.invalid");
    put(path.join(root, "README.md"), "# Existing guide\n");
    put(path.join(root, "website/package.json"), "{}");
    put(path.join(root, "website/package-lock.json"), "{}");
    put(path.join(root, ".github/workflows/docs-maintenance.yml"), "name: trusted fixture\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    put(path.join(root, "README.md"), "# Updated guide\n");
    git("commit", "-qam", "guide change");
    const head = git("rev-parse", "HEAD");
    execFileSync("git", ["clone", "-q", "--no-hardlinks", root, trusted]);
    execFileSync("git", ["-C", trusted, "checkout", "-q", base]);
    execFileSync("git", ["-C", trusted, "update-ref", "refs/remotes/origin/main", base]);
    const validator = path.join(trusted, ".github/scripts/docs/fact-check.mjs");
    put(validator, `
      import assert from "node:assert/strict";
      import { appendFileSync } from "node:fs";
      for (const name of ["GH_TOKEN","GITHUB_TOKEN","DOCS_ACTIONS_TOKEN","COPILOT_GITHUB_TOKEN"])
        assert.equal(process.env[name], undefined, name);
      appendFileSync(process.env.TEST_TRACE, "validate\\n");
    `);
    const entries = execFileSync("git", ["-C", trusted, "ls-tree", "-r", base, "--",
      ".github/scripts/docs", ".github/agents/docs-writer.agent.md",
      ".github/agents/docs-fact-checker.agent.md", ".github/workflows/docs-maintenance.yml"],
    { encoding: "utf8" }).trimEnd();
    const identity = { head, base, tree: git("rev-parse", "HEAD^{tree}"), policy: policyDigest(entries) };
    const report = {
      schemaVersion: 1, headSha: head, baseSha: base, claims: [{ status: "supported" }],
      omissions: [], coverage: { reviewedFiles: ["README.md"], unreviewedFiles: [] },
    };
    const run = {
      id: 21, run_attempt: 1, path: ".github/workflows/docs-maintenance.yml",
      event: "pull_request", head_sha: head, status: "completed", conclusion: "success",
      created_at: new Date().toISOString(),
      pull_requests: [{ number: 35, head: { sha: head }, base: { sha: base } }],
    };
    const envelope = {
      schemaVersion: 1, runId: 21, runAttempt: 1, repository: "fixture/repo",
      prNumber: 35, identity, report,
    };
    const scripts = {
      gh: `
        const {appendFileSync}=require("node:fs");
        const assert=require("node:assert/strict");
        const endpoint=process.argv[3];
        appendFileSync(process.env.TEST_TRACE,"api:"+endpoint+"\\n");
        const run=JSON.parse(process.env.TEST_RUN);
        if(endpoint.endsWith("/protection")) console.log(JSON.stringify({
          required_status_checks:{strict:true,checks:[
            {context:"Required CI",app_id:15368},{context:"Verify docs maintenance PR",app_id:15368}]},
          allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}
        }));
        else if(endpoint.endsWith("/rules/branches/main")) console.log("[]");
        else {
          assert.equal(process.env.GH_TOKEN,"actions-fixture");
          assert.equal(process.env.COPILOT_GITHUB_TOKEN,undefined);
          if(endpoint.includes("/actions/artifacts?")) console.log(JSON.stringify({
            total_count:process.env.TEST_MODE==="cached"||process.env.TEST_MODE==="bad-provenance"?1:0,
            artifacts:process.env.TEST_MODE==="cached"||process.env.TEST_MODE==="bad-provenance"?
              [{id:11,name:process.env.TEST_ARTIFACT_NAME,workflow_run:{id:21},expired:false}]:[]
          }));
          else if(endpoint.endsWith("/zip")) console.log("fixture-archive");
          else if(endpoint.includes("/attempts/")) console.log(JSON.stringify({
            ...run,head_sha:process.env.TEST_MODE==="bad-provenance"?"0".repeat(40):run.head_sha
          }));
          else if(endpoint.includes("/runs?")) console.log(JSON.stringify({
            total_count:process.env.TEST_MODE==="cap"?1:0,
            workflow_runs:process.env.TEST_MODE==="cap"?[{...run,run_attempt:3}]:[]
          }));
          else throw new Error("Unexpected API: "+endpoint);
        }
      `,
      unzip: 'console.log(process.env.TEST_ENVELOPE);',
      npm: `
        const {appendFileSync}=require("node:fs");
        const assert=require("node:assert/strict");
        for(const name of ["GH_TOKEN","GITHUB_TOKEN","DOCS_ACTIONS_TOKEN","COPILOT_GITHUB_TOKEN"])
          assert.equal(process.env[name],undefined,name);
        appendFileSync(process.env.TEST_TRACE,"build\\n");
        if(process.env.TEST_MODE==="build-failure") process.exit(1);
      `,
      copilot: `
        const {appendFileSync}=require("node:fs");
        const assert=require("node:assert/strict");
        if(process.argv[2]==="--version"){console.log("1.0.105");process.exit(0);}
        assert.equal(process.env.DOCS_ACTIONS_TOKEN,undefined);
        assert.equal(process.env.GH_TOKEN,undefined);
        appendFileSync(process.env.TEST_TRACE,"model\\n");
        console.log(process.env.TEST_REPORT);
      `,
    };
    for (const [name, script] of Object.entries(scripts)) {
      const target = path.join(bin, name);
      put(target, `#!${process.execPath}\n${script}`);
      chmodSync(target, 0o755);
    }
    const event = path.join(directory, "event.json");
    put(event, JSON.stringify({ pull_request: { number: 35 } }));
    const trace = path.join(directory, "trace");
    const output = path.join(directory, "output");
    const verdict = path.join(directory, "verdict");
    const result = spawnSync(process.execPath, [
      new URL("./runtime.mjs", import.meta.url).pathname, "verify-pr",
      "--trusted-root", trusted, "--candidate-root", root, "--base", base, "--head", head,
    ], {
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GH_TOKEN: "policy-fixture", COPILOT_GITHUB_TOKEN: "copilot-fixture",
        DOCS_ACTIONS_TOKEN: "actions-fixture", DOCS_VERDICT_OUTPUT: verdict,
        DOCS_TRUSTED_ROOT: trusted, GITHUB_REPOSITORY: "fixture/repo",
        GITHUB_HEAD_REPOSITORY: "fixture/repo", GITHUB_EVENT_PATH: event,
        GITHUB_RUN_ID: "99", GITHUB_RUN_ATTEMPT: "1", GITHUB_OUTPUT: output,
        TEST_MODE: mode, TEST_TRACE: trace, TEST_RUN: JSON.stringify(run),
        TEST_ENVELOPE: JSON.stringify(envelope), TEST_REPORT: JSON.stringify(report),
        TEST_ARTIFACT_NAME: verdictArtifactName(identity),
      },
    });
    const calls = readFileSync(trace, "utf8").trim().split("\n");
    const passes = mode === "cached" || mode === "fresh";
    assert.equal(result.status, passes ? 0 : 1, result.stderr);
    assert.equal(calls.filter((entry) => entry === "model").length, mode === "fresh" ? 1 : 0);
    assert.ok(calls.indexOf("build") >= 0);
    if (passes) {
      assert.equal(calls.at(-1), "validate");
      assert.deepEqual(JSON.parse(readFileSync(path.join(verdict, "docs-verdict.json"))).report, report);
      assert.match(readFileSync(output, "utf8"), new RegExp(verdictArtifactName(identity)));
    }
    if (mode === "cap") assert.match(result.stderr, /daily cap reached/);
    if (mode === "bad-provenance") assert.match(result.stderr, /provenance/);
    if (mode === "build-failure") assert.ok(!calls.some((entry) => entry.includes("/actions/")));
  });
}
