import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isImplementationEvidencePath, main, validateReport } from "./fact-check.mjs";

const script = fileURLToPath(new URL("./fact-check.mjs", import.meta.url));

function setup(t, files = { "docs/guide.md": "The counter starts at one.\n", "server/count.ts": "export const count = 1;\n" }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "touchline-fact-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "repo");
  mkdirSync(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fact-check fixture");
  git("config", "commit.gpgsign", "false");
  const put = (name, value) => {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, value);
  };
  for (const [name, value] of Object.entries(files)) put(name, value);
  const commit = () => {
    git("add", ".");
    git("commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const head = commit();
  const reportPath = path.join(dir, "report.json");
  const ref = (name, extra = {}) => ({ path: name, startLine: 1, endLine: 1, explanation: "Direct source reference.", ...extra });
  const claim = (names = Object.keys(files)) => ({
    id: "counter", claim: "Counter starts at one.", status: "supported", subjectFiles: names,
    evidence: names.map((name) => ref(name)),
  });
  const report = { schemaVersion: 1, headSha: head, baseSha: head, claims: [claim()],
    omissions: [], coverage: { reviewedFiles: Object.keys(files), unreviewedFiles: [] } };
  const options = { root, head, base: head, reportPath };
  const run = () => {
    writeFileSync(reportPath, JSON.stringify(report));
    return validateReport(options);
  };
  return { dir, root, git, put, commit, reportPath, ref, claim, report, options, run };
}

test("valid baseline and CLI success are revision-pinned", (t) => {
  const f = setup(t);
  assert.equal(f.run().requiredFiles, 1);
  const result = spawnSync(process.execPath, [script, "--report", f.reportPath, "--root", f.root,
    "--head", f.options.head, "--base", f.options.base], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result, "pass");
});

test("artwork and its design source cannot substitute for current implementation evidence", () => {
  for (const name of ["docs/scripts/social-card.html", "docs/public/images/social/touchline-docs.png"]) {
    assert.equal(isImplementationEvidencePath(name), false, name);
  }
  for (const name of ["docs/src/layouts/BaseLayout.astro", "website/src/layouts/BaseLayout.astro", "server/db.ts"]) {
    assert.equal(isImplementationEvidencePath(name), true, name);
  }
});

test("site relocation preserves full current-guide evidence and only exempts identical moved binaries", (t) => {
  const f = setup(t, {
    "website/package.json": "{}\n",
    "website/package-lock.json": "{}\n",
    "website/src/content/docs/guide.md": "The counter starts at one.\n",
    "website/src/lib/count.ts": "export const count = 1;\n",
    "website/public/images/game/shot.png": Buffer.from([137, 80, 78, 71, 0]),
  });
  f.git("mv", "website", "docs");
  const head = f.commit();
  f.options.head = head;
  f.report.headSha = head;
  const names = ["docs/src/content/docs/guide.md", "docs/src/lib/count.ts"];
  f.report.claims = [f.claim(names)];
  f.report.coverage.reviewedFiles = names;
  assert.equal(f.run().requiredFiles, 1);
  f.report.claims = [f.claim(["docs/src/lib/count.ts"])];
  f.report.coverage.reviewedFiles = ["docs/src/lib/count.ts"];
  assert.throws(f.run, /Missing material coverage/);
  f.report.claims = [f.claim(names)];
  f.report.coverage.reviewedFiles = names;
  f.put("docs/public/images/game/shot.png", Buffer.from([137, 80, 78, 71, 0, 1]));
  f.options.head = f.commit();
  f.report.headSha = f.options.head;
  assert.throws(f.run, /Missing material coverage/);
  f.report.coverage.reviewedFiles.push("docs/public/images/game/shot.png");
  assert.throws(f.run, /Binary evidence/);
});

for (const [name, mutate, message] of [
  ["wrong head", (f) => { f.report.headSha = "a".repeat(40); }, /stale/],
  ["wrong base", (f) => { f.report.baseSha = "b".repeat(40); }, /stale/],
  ["wrong schema", (f) => { f.report.schemaVersion = 2; }, /Malformed/],
  ["missing claims", (f) => { delete f.report.claims; }, /Missing/],
  ["empty claims", (f) => { f.report.claims = []; }, /Missing/],
  ["empty coverage", (f) => { f.report.coverage.reviewedFiles = []; }, /reviewedFiles/],
  ["missing coverage", (f) => { delete f.report.coverage; }, /Missing/],
  ["unreviewed files", (f) => { f.report.coverage.unreviewedFiles = ["server/count.ts"]; }, /Unreviewed/],
  ["unknown coverage", (f) => { f.report.coverage.reviewedFiles.push("server/missing.ts"); }, /Unknown/],
  ["duplicate claim id", (f) => { f.report.claims.push(f.report.claims[0]); }, /Invalid/],
  ["contradiction", (f) => { f.report.claims[0].status = "contradicted"; }, /contradicted/],
  ["uncertainty", (f) => { f.report.claims[0].status = "unverified"; }, /unverified/],
  ["self-awarded pass", (f) => { f.report.claims[0].status = "pass"; f.report.pass = true; }, /Invalid/],
  ["unresolved omission", (f) => { f.report.omissions = [{ description: "Missing update", status: "unresolved", evidence: [] }]; }, /unresolved/],
  ["empty omission evidence", (f) => { f.report.omissions = [{ description: "Fixed", status: "resolved", evidence: [] }]; }, /Missing evidence/],
  ["no evidence", (f) => { f.report.claims[0].evidence = []; }, /Missing evidence/],
  ["documentation-only evidence", (f) => {
    f.report.claims[0].subjectFiles = ["docs/guide.md"];
    f.report.claims[0].evidence = [f.ref("docs/guide.md")];
  }, /implementation evidence/],
  ["base-only support", (f) => {
    f.report.claims[0].evidence.forEach((item) => { item.revision = "base"; });
  }, /Current implementation/],
  ["invalid revision", (f) => { f.report.claims[0].evidence[0].revision = "main"; }, /Malformed evidence/],
  ["out-of-bounds line", (f) => { f.report.claims[0].evidence[0].endLine = 2; }, /out of bounds/],
  ["zero line", (f) => { f.report.claims[0].evidence[0].startLine = 0; }, /Malformed evidence/],
  ["fractional line", (f) => { f.report.claims[0].evidence[0].endLine = 1.5; }, /Malformed evidence/],
  ["reversed lines", (f) => { f.report.claims[0].evidence[0].startLine = 2; }, /Malformed evidence/],
  ["missing explanation", (f) => { f.report.claims[0].evidence[0].explanation = ""; }, /Malformed evidence/],
  ["missing subject", (f) => { f.report.claims[0].subjectFiles = []; }, /subjectFiles/],
  ["subject without reference", (f) => { f.report.claims[0].evidence.shift(); }, /direct evidence/],
  ["traversal", (f) => { f.report.claims[0].evidence[0].path = "../outside"; }, /Invalid repository path/],
  ["absolute path", (f) => { f.report.claims[0].evidence[0].path = "/etc/passwd"; }, /Invalid repository path/],
  ["backslash path", (f) => { f.report.claims[0].evidence[0].path = "server\\count.ts"; }, /Invalid repository path/],
  ["git internals", (f) => { f.report.claims[0].evidence[0].path = ".git/config"; }, /Invalid repository path/],
  ["untracked evidence", (f) => {
    f.put("server/untracked.ts", "true\n");
    f.report.claims[0].evidence.push(f.ref("server/untracked.ts"));
  }, /not a tracked regular file/],
  ["dirty checkout", (f) => { f.put("server/count.ts", "export const count = 2;\n"); }, /tracked modifications/],
  ["wrong actual checkout", (f) => { f.options.head = "a".repeat(40); }, /Checkout HEAD/],
  ["invalid sha", (f) => { f.options.base = "--help"; }, /40-hex/],
  ["invalid mode", (f) => { f.options.mode = "pass"; }, /mode/],
]) {
  test(`blocks ${name}`, (t) => {
    const f = setup(t);
    mutate(f);
    assert.throws(f.run, message);
  });
}

test("malformed JSON and missing reports fail with nonzero CLI exit", (t) => {
  const f = setup(t);
  writeFileSync(f.reportPath, "{broken");
  assert.throws(() => validateReport(f.options), SyntaxError);
  const result = spawnSync(process.execPath, [script, "--report", `${f.reportPath}.missing`,
    "--head", f.options.head, "--base", f.options.base, "--root", f.root], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FACT-CHECK BLOCKED/);
});

test("report in checkout or a symlink is rejected", (t) => {
  const f = setup(t);
  f.run();
  const link = path.join(f.dir, "link.json");
  symlinkSync(f.reportPath, link);
  assert.throws(() => validateReport({ ...f.options, reportPath: link }), /regular/);
  f.options.reportPath = path.join(f.root, "report.json");
  f.run = () => {
    writeFileSync(f.options.reportPath, JSON.stringify(f.report));
    return validateReport(f.options);
  };
  assert.throws(f.run, /outside the checkout/);
});

test("tracked symlink, binary evidence and unsupported document-source files block", (t) => {
  for (const kind of ["symlink", "binary", "document"]) {
    const f = setup(t);
    const name = kind === "document" ? "server/design.txt" : "server/unsafe.ts";
    if (kind === "symlink") symlinkSync("count.ts", path.join(f.root, name));
    else f.put(name, kind === "binary" ? Buffer.from([0, 1, 2]) : "Design says it works.\n");
    const head = f.commit();
    f.options.head = f.report.headSha = head;
    f.report.coverage.reviewedFiles.push(name);
    f.report.claims = [f.claim(["docs/guide.md", name])];
    assert.throws(f.run, kind === "symlink" ? /regular file/ : kind === "binary" ? /Binary/ : /implementation evidence/);
  }
});

test("affected review cannot omit changed source even if all guide claims pass", (t) => {
  const f = setup(t);
  f.put("server/count.ts", "export const count = 2;\n");
  f.options.head = f.report.headSha = f.commit();
  f.options.mode = "affected";
  f.report.claims[0].subjectFiles = ["docs/guide.md"];
  assert.throws(f.run, /Missing material coverage: server\/count.ts/);
  f.report.claims[0].subjectFiles.push("server/count.ts");
  assert.equal(f.run().requiredFiles, 1);
});

test("baseline covers website guide and DEVELOPMENT, affected mode is externally selected", (t) => {
  const f = setup(t);
  f.put("website/src/content/docs/start.md", "Start here.\n");
  f.put("DEVELOPMENT.md", "Developer instructions.\n");
  f.options.head = f.report.headSha = f.commit();
  f.options.base = f.report.baseSha = f.options.head;
  f.report.mode = "affected";
  assert.throws(f.run, /Missing material coverage/);
  for (const name of ["website/src/content/docs/start.md", "DEVELOPMENT.md"]) {
    f.report.coverage.reviewedFiles.push(name);
    f.report.claims[0].subjectFiles.push(name);
    f.report.claims[0].evidence.push(f.ref(name));
  }
  assert.equal(f.run().requiredFiles, 3);
  f.options.mode = "affected";
  assert.throws(f.run, /No review scope/);
});

test("deleted files can be reviewed using base evidence, with current implementation support", (t) => {
  const f = setup(t);
  f.git("rm", "--quiet", "docs/guide.md");
  f.options.head = f.report.headSha = f.commit();
  f.options.mode = "affected";
  f.report.claims[0].evidence[0].revision = "base";
  assert.equal(f.run().requiredFiles, 1);
});

test("resolved omissions require the same sourced disposition as claims", (t) => {
  const f = setup(t);
  f.report.omissions.push({ description: "Counter update incorporated.", status: "resolved",
    subjectFiles: ["server/count.ts"], evidence: [f.ref("server/count.ts")] });
  assert.equal(f.run().claims, 1);
});

test("all canonical baseline guide files require direct current evidence", (t) => {
  const files = {
    "README.md": "Overview.\n",
    "REQUIREMENTS.md": "Requirements.\n",
    "CONTRIBUTING.md": "Contributing.\n",
    "DEVELOPMENT.md": "Development.\n",
    "website/src/content/docs/start.md": "Start.\n",
    "website/src/content/docs/nested/advanced.mdx": "Advanced.\n",
    "server/count.ts": "export const count = 1;\n",
  };
  const f = setup(t, files);
  assert.equal(f.run().requiredFiles, 6);
  f.report.claims[0].subjectFiles = ["server/count.ts"];
  assert.throws(f.run, /Missing material coverage/);
});

test("new files, renamed files and deleted source are not silently excluded", (t) => {
  const f = setup(t);
  f.git("mv", "server/count.ts", "server/counter.ts");
  f.put("server/new.ts", "export const next = 2;\n");
  f.options.head = f.report.headSha = f.commit();
  f.options.mode = "affected";
  assert.throws(f.run, /not a tracked regular file/);
  f.report.claims[0].evidence[1].revision = "base";
  for (const name of ["server/counter.ts", "server/new.ts"]) {
    f.report.coverage.reviewedFiles.push(name);
    f.report.claims[0].subjectFiles.push(name);
    f.report.claims[0].evidence.push(f.ref(name));
  }
  assert.equal(f.run().requiredFiles, 3);
});

test("skip-worktree cannot hide changed evidence from byte comparison", (t) => {
  const f = setup(t);
  f.git("update-index", "--skip-worktree", "server/count.ts");
  f.put("server/count.ts", "export const count = 999;\n");
  assert.throws(f.run, /differs from exact revision/);
});

test("symlinked directories and files cannot replace exact checkout evidence", (t) => {
  for (const directory of [false, true]) {
    const f = setup(t);
    f.git("update-index", "--skip-worktree", "server/count.ts");
    const external = path.join(f.dir, "external");
    mkdirSync(external);
    writeFileSync(path.join(external, "count.ts"), "export const count = 1;\n");
    if (directory) {
      rmSync(path.join(f.root, "server"), { recursive: true });
      symlinkSync(external, path.join(f.root, "server"));
    } else {
      rmSync(path.join(f.root, "server/count.ts"));
      symlinkSync(path.join(external, "count.ts"), path.join(f.root, "server/count.ts"));
    }
    assert.throws(f.run, /Symlink|tracked modifications/);
  }
});

test("fixture documentation cannot masquerade as implementation evidence", (t) => {
  const f = setup(t, { "docs/guide.md": "A claim.\n", "server/fixtures/example.ts": "// A mock.\n" });
  assert.throws(f.run, /implementation evidence/);
});

test("non-ancestor base cannot shrink the review interval", (t) => {
  const f = setup(t);
  f.put("server/count.ts", "export const count = 2;\n");
  const other = f.commit();
  f.git("checkout", "--quiet", f.options.head);
  f.options.base = f.report.baseSha = other;
  assert.throws(f.run);
});

test("report command strings are inert data; no shell is invoked", (t) => {
  const f = setup(t);
  f.report.command = "touch SHOULD_NOT_EXIST";
  f.report.claims[0].claim = "$(touch SHOULD_NOT_EXIST)";
  assert.equal(f.run().claims, 1);
  assert.throws(() => readFileSync(path.join(f.root, "SHOULD_NOT_EXIST")), /ENOENT/);
});

test("CLI rejects duplicate, incomplete or unknown arguments", () => {
  assert.throws(() => main(["--report", "a", "--report", "b"]), /duplicate/);
  assert.throws(() => main(["--root"]), /Invalid/);
  assert.throws(() => main(["--shell", "whoami"]), /Invalid/);
  assert.throws(() => main([]), /Missing/);
});

test("Touchline baseline fixture blocks the unsupported world-expansion instruction", (t) => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/touchline-world-expansion.json", import.meta.url)));
  assert.equal(fixture.sourceRevision, "514e1e8d7c69d06498f33d37bbee4fcf1b4d9a24");
  const f = setup(t, Object.fromEntries(fixture.excerpts.map((item) => [item.path, item.text])));
  f.report.claims[0].claim = fixture.claim;
  f.report.claims[0].status = fixture.status;
  assert.throws(f.run, /contradicted/);
  // Replacing factual investigation with the requirements text is not enough.
  f.report.claims[0].status = "supported";
  f.report.claims[0].subjectFiles = ["REQUIREMENTS.md"];
  f.report.claims[0].evidence = [f.ref("REQUIREMENTS.md")];
  assert.throws(f.run, /implementation evidence/);
});
