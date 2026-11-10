## Code graph (Graphify): the graph is the answer

`graphify-out/graph.json` is a current graph of this repository's calls, imports and doc references, extracted
from the TypeScript AST and refreshed by the `.githooks/pre-commit` hook. For structural questions (who calls X,
what breaks if X changes, which tests exercise X, how A reaches B), one graphify command at enough depth replaces a
chain of greps and file reads (server/simulation.ts alone is about 150 KB). Run it from the repository root, answer
from its output and cite the file:line locations it prints. Do not re-derive with grep what the graph already
returned. Measured on this repo: about 0.3x to 0.6x the tokens of grep/read for the same accuracy
(`scripts/bench-graphify/REPORT.md`).

| Question                                                   | One command                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| What can reach X (callers of callers up to routes/entries) | `graphify affected "X" --depth 6 --relation calls`                |
| Blast radius of changing X within N call hops              | `graphify affected "X" --depth N --relation calls`                |
| Everything touching X: callers, importers, tests, docs     | `graphify affected "X" --depth 1`                                 |
| Which tests exercise X within N hops                       | the `--relation calls` chain above, then the test-file step below |
| What X calls, and who calls X directly                     | `graphify explain "X"`                                            |
| How A reaches B                                            | `graphify path "A" "B"`                                           |
| Where a feature lives                                      | `graphify query "<words>" --budget 2000` (`--seed X` to focus)    |
| Hub symbols, surprising connections, communities           | read that section of `graphify-out/GRAPH_REPORT.md`               |
| Aggregates: fan-in, unreferenced exports, most imported    | a short python3 script over `graphify-out/graph.json` (see below) |

- Pass bare names (`"advance"`); output labels functions as `advance()`. `--relation calls` keeps production
  call chains; without it, `imports` edges also pull in modules and test files that merely import the file, so
  filter that list to the files that actually call into the chain.
- Every line of `affected` is `- label() [relation] file:Lline`: that list is the answer set.
- Tests mostly call production code from inside test callbacks, which the graph does not link. For "which tests
  exercise X", take the function names from `graphify affected "X" --depth N --relation calls`, list candidate
  files with `grep -rlwE "X|name1|name2" --include="*.test.ts" server shared src`, then keep only files that call
  one of those functions (common names such as `advance` or `decide` also match unrelated code).
- graph.json: `nodes[]` have `id`, `label`, `source_file`, `source_location`; `links[]` have `source`, `target`
  (node ids), `relation` (`calls`, `imports`, `imports_from`, `references`, `contains`) and `confidence`.
- GRAPH_REPORT.md sections: God Nodes, Surprising Connections, Import Cycles, Communities. Read sections, not the
  whole file. Its Import Cycles list is a sample of short cycles, not every file in a cycle: for a complete answer
  compute strongly connected components over the `imports` and `imports_from` links (mapped to `source_file`) in
  graph.json, then drop cycles that exist only through `import type`.
- Open source files only to confirm an INFERRED edge, when the graph returns nothing, or before editing.
- Blind spots, where grep is the right tool: a client URL string to its Express route (grep `server/app.ts`),
  method calls such as `store.run()`, and calls made inside test callbacks.
- If the graph looks stale, run `npm run graph:update` (code-only, no LLM). Setup and details: DEVELOPMENT.md,
  "Code graph (Graphify)". Type `/graphify` in Copilot Chat to rebuild with docs.
