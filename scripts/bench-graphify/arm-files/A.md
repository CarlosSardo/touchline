## Code search: precise, few calls

This is a TypeScript repository (`server/`, `shared/`, `src/`, `scripts/`, docs in `docs/` and the root `*.md`).
Large files exist (`server/simulation.ts` is about 150 KB), so search precisely and read only the lines you
need. Prefer one well-aimed command over many small ones, and answer as soon as the evidence is sufficient.

| Question                                        | Efficient approach                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| Where is X defined                              | `rg -n "function X\b\|const X\b\|class X\b" server shared src scripts`              |
| Who calls or imports X                          | `rg -nw "X" --type ts` (add `-g '!*.test.ts'` to drop tests)                        |
| Callers of callers (reachability, blast radius) | repeat the caller search per hop; batch names: `rg -nw "A\|B\|C" --type ts`         |
| What X calls                                    | read X's body with `sed -n 'START,ENDp' file`, using line numbers from `rg -n`      |
| Which files import a module                     | `rg -l "from \"\./module\.ts\"" server`                                             |
| Import cycles, fan-in, unreferenced exports     | a short node or python3 script over `rg` output, or `npx tsc` diagnostics           |
| Docs that mention X                             | `rg -n "X" --type md`                                                               |
| Which tests cover X                             | `rg -lw "X" -g '*.test.ts'`, then the tests of X's callers                          |
| What breaks if X's signature changes            | add the change in a scratch copy and run `npx tsc -p tsconfig.server.json --noEmit` |

- `rg` respects `.gitignore` and is much faster than `grep -r`; `-w` matches whole words, `-l` lists files only,
  `-C2` adds context, `--type ts` covers `.ts` and `.tsx`.
- Use the `grep` and `glob` tools or `rg` in the shell; avoid reading whole large files with `view`.
- Express routes are registered in `server/app.ts` (`createWorldRouter`, `createApp`); the client builds request
  paths in `src/*.ts` helpers and fetches them from React components in `src/*.tsx`.
- Confirm each answer item against the code once; do not re-search what you already verified.
