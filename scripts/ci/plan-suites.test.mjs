import assert from "node:assert/strict";
import test from "node:test";
import { requiresApplicationCi } from "./plan-suites.mjs";

test("documentation and editor-only changes intentionally skip application suites", () => {
  assert.equal(requiresApplicationCi([
    "README.md",
    "website/src/content/docs/guide.md",
    "LICENSE",
    ".env.example",
    ".copilot/instructions.md",
    ".vscode/settings.json",
    ".mcp.json",
    ".github/agents/docs-writer.agent.md",
    ".github/skills/docs/SKILL.md",
    "website/src/pages/index.astro",
    "website/src/content/docs/guide.mdx",
    ".github/workflows/docs.yml",
  ]), false);
  assert.equal(requiresApplicationCi([]), false);
});

test("application and non-ignored automation changes require CI suites", () => {
  for (const path of [
    "src/App.tsx",
    ".github/workflows/ci.yml",
    ".github/scripts/docs/runtime.mjs",
    "scripts/ci/plan-suites.mjs",
  ]) {
    assert.equal(requiresApplicationCi([path]), true, path);
  }
});

test("invalid path inventories fail rather than silently skipping CI", () => {
  assert.throws(() => requiresApplicationCi(null), /array of strings/);
  assert.throws(() => requiresApplicationCi(["README.md", null]), /array of strings/);
});
