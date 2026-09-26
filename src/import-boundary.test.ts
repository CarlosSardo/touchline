import { describe, expect, it } from "vitest";

// Raw sources of everything the client bundle could reach: src itself and the shared folder it imports from.
const sources = import.meta.glob<string>(["./**/*.{ts,tsx}", "../shared/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const root = "file:///repo/src/";
const files = new Map(
  Object.entries(sources).map(([key, text]) => [new URL(key, root).pathname, text]),
);
// Static imports/re-exports (group 1 marks `import type`), dynamic imports that are not type references
// such as `import("./x.ts").Type`, and side-effect imports.
const importPattern =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)(?!\s*\.\s*[A-Za-z_$][\w$]*(?![\w$])(?!\s*\())|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function imports(path: string) {
  return [...(files.get(path) ?? "").matchAll(importPattern)]
    .map((match) => ({ typeOnly: !!match[1], spec: match[2] ?? match[3] ?? match[4] }))
    .filter((entry) => entry.spec.startsWith("."))
    .map((entry) => ({ ...entry, path: new URL(entry.spec, `file://${path}`).pathname }));
}

const forbidden = (path: string) =>
  path.includes("/shared/world-catalog/") || path.startsWith("/repo/server/");

describe("client bundle boundary", () => {
  it("finds the client entry and the shared modules", () => {
    expect(files.has("/repo/src/main.tsx")).toBe(true);
    expect(files.has("/repo/shared/rules.ts")).toBe(true);
  });

  it("never imports the world catalog or server code from src", () => {
    const direct = [...files.keys()]
      .filter((path) => path.startsWith("/repo/src/"))
      .flatMap((path) =>
        imports(path)
          .filter((entry) => forbidden(entry.path))
          .map((entry) => `${path} -> ${entry.spec}`),
      );
    expect(direct).toEqual([]);
  });

  it("keeps the world catalog out of everything the client reaches at runtime", () => {
    const seen = new Set<string>();
    const queue = ["/repo/src/main.tsx"];
    const reached: string[] = [];
    while (queue.length) {
      const path = queue.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      if (forbidden(path)) reached.push(path);
      for (const entry of imports(path))
        if (!entry.typeOnly && /\.(ts|tsx)$/.test(entry.path)) queue.push(entry.path);
    }
    expect(seen.size).toBeGreaterThan(20);
    expect(reached).toEqual([]);
  });
});
