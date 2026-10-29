import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRequiredPath = (value) =>
  !/(^|\/)[^/]*\.md$/.test(value) &&
  value !== "LICENSE" &&
  value !== ".env.example" &&
  !value.startsWith(".copilot/") &&
  !value.startsWith(".vscode/") &&
  value !== ".mcp.json" &&
  !value.startsWith(".github/agents/") &&
  !value.startsWith(".github/skills/") &&
  !value.startsWith("docs/") &&
  value !== ".github/workflows/docs.yml";

export function requiresApplicationCi(paths) {
  if (!Array.isArray(paths) || paths.some((value) => typeof value !== "string")) {
    throw new Error("Changed paths must be an array of strings");
  }
  return paths.some(sourceRequiredPath);
}

function changedPaths(base, head) {
  for (const [label, value] of [["base", base], ["head", head]]) {
    if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`Invalid ${label} SHA`);
  }
  const output = execFileSync("git", [
    "diff", "--name-only", "--no-renames", "-z", `${base}...${head}`,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return output.split("\0").filter(Boolean);
}

function main(args) {
  if (args.length !== 4 || args[0] !== "--base" || args[2] !== "--head") {
    throw new Error("Usage: plan-suites.mjs --base <sha> --head <sha>");
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  const required = requiresApplicationCi(changedPaths(args[1], args[3]));
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${required}\n`);
  console.log(required ? "Application changes require CI suites." : "Only documentation/editor paths changed; CI suites are skipped.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`CI planning failed: ${error.message}`);
    process.exitCode = 1;
  }
}
