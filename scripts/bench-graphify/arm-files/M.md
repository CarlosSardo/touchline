## Code graph (Graphify MCP): the graph is the answer

The `graphify` MCP server serves a current graph of this repository's calls, imports and doc references,
extracted from the TypeScript AST and refreshed on every commit. Its tools are named `graphify-<tool>`. For
structural questions, one graph tool call at enough depth replaces a chain of greps and file reads: answer from
its output and cite the file:line locations it returns. Do not re-derive with grep what the graph already returned.

| Question                                                 | One tool call                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| What X calls, and who calls X directly                   | `graphify-get_neighbors` with `label` X, `relation_filter` `calls`                                                          |
| Everything touching X: callers, importers, tests, docs   | `graphify-get_neighbors` with `label` X                                                                                     |
| Callers of callers, blast radius within N hops           | `get_neighbors` per hop (call the labels of one hop in parallel), or a python3 reverse BFS over `calls` links in graph.json |
| How A reaches B                                          | `graphify-shortest_path`                                                                                                    |
| Where a feature lives                                    | `graphify-query_graph` with a question and `token_budget` 2000                                                              |
| Hub symbols and communities                              | `graphify-god_nodes`, `graphify-get_community`                                                                              |
| Import cycles, aggregates (fan-in, unreferenced exports) | `grep -n -A30 "## Import Cycles" graphify-out/GRAPH_REPORT.md`, or a short python3 script over `graphify-out/graph.json`    |

- Pass bare names (`advance`); results label functions as `advance()` with `file:Lline`. That list is the answer set.
- graph.json: `nodes[]` have `id`, `label`, `source_file`, `source_location`; `links[]` have `source`, `target`
  (node ids), `relation` (`calls`, `imports`, `imports_from`, `references`, `contains`) and `confidence`.
- If a graph tool is not yet loaded, load the `graphify-` tools once with tool search, then call them directly.
- Open source files only to confirm an INFERRED edge, when the graph returns nothing, or before editing.
- Blind spots, where grep is the right tool: a client URL string to its Express route (grep `server/app.ts`),
  method calls such as `store.run()`, and calls made inside test callbacks.
