## Code graph (Graphify): the graph is the answer

`graphify-out/graph.json` is a current graph of this repository's calls, imports and doc references, extracted
from the TypeScript AST and refreshed on every commit. For structural questions, one graphify command at enough
depth replaces a chain of greps and file reads. Run it from the repository root, answer from its output and cite
the file:line locations it prints. Do not re-derive with grep what the graph already returned.

| Question                                                   | One command                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| What can reach X (callers of callers up to routes/entries) | `graphify affected "X" --depth 6 --relation calls`                |
| Blast radius of changing X within N call hops              | `graphify affected "X" --depth N --relation calls`                |
| Everything touching X: callers, importers, tests, docs     | `graphify affected "X" --depth 1`                                 |
| What X calls, and who calls X directly                     | `graphify explain "X"`                                            |
| How A reaches B                                            | `graphify path "A" "B"`                                           |
| Where a feature lives                                      | `graphify query "<words>" --budget 2000` (`--seed X` to focus)    |
| Import cycles, hub symbols, communities                    | `grep -n -A30 "## Import Cycles" graphify-out/GRAPH_REPORT.md`    |
| Aggregates: fan-in, unreferenced exports, most imported    | a short python3 script over `graphify-out/graph.json` (see below) |

- Pass bare names (`"advance"`); output labels functions as `advance()`. `--relation calls` keeps production
  call chains; without it, `imports` edges also list test files and modules.
- Every line of `affected` is `- label() [relation] file:Lline`: that list is the answer set.
- graph.json: `nodes[]` have `id`, `label`, `source_file`, `source_location`; `links[]` have `source`, `target`
  (node ids), `relation` (`calls`, `imports`, `imports_from`, `references`, `contains`) and `confidence`.
- GRAPH_REPORT.md sections: God Nodes, Surprising Connections, Import Cycles, Communities. Read sections, not the
  whole file.
- Open source files only to confirm an INFERRED edge, when the graph returns nothing, or before editing.
- Blind spots, where grep is the right tool: a client URL string to its Express route (grep `server/app.ts`),
  method calls such as `store.run()`, and calls made inside test callbacks.
