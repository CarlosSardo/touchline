## graphify

For any question about this repo's architecture, structure, components, or how to add/modify/find
code, your first action should be `graphify query "<question>"` when `graphify-out/graph.json`
exists. Use `graphify path "<A>" "<B>"` for relationship questions and `graphify explain "<concept>"`
for focused-concept questions. These return a scoped subgraph, usually much smaller than the full
report or raw grep output.

Triggers: "how do I…", "where is…", "what does … do", "add/modify a <component>",
"explain the architecture", or anything that depends on how files or classes relate.

If `graphify-out/wiki/index.md` exists, use it for broad navigation. Read `graphify-out/GRAPH_REPORT.md`
only for broad architecture review or when query/path/explain do not surface enough context. Only read
source files when (a) modifying/debugging specific code, (b) the graph lacks the needed detail, or
(c) the graph is missing or stale.

Type `/graphify` in Copilot Chat to build or update the graph.

### Touchline: graph before grep

`graphify-out/graph.json` is committed and refreshed by the `.githooks/pre-commit` hook, so it is
current. Before running grep or opening large files (server/simulation.ts alone is about 150 KB), run the matching
command from the repository root and then read only the lines it points to:

| Question                           | Command                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| What does X call, and who calls X? | `graphify explain "X"` (callers and callees with file:line) |
| What breaks if I change X?         | `graphify affected "X" --depth 1`                           |
| How does A reach B?                | `graphify path "A" "B"`, then `graphify explain` each hop   |
| Where is the code for a feature?   | `graphify query "<feature words>" --budget 1500`            |

Caveats: `god-nodes` ranks by total edges, not imports; `path` may shortcut through `contains`/`imports`
edges, so confirm call chains with `explain`; the graph cannot link a client URL string to its Express
route (grep `server/app.ts` for those). If the graph looks stale, run `npm run graph:update` (code-only,
no LLM). Setup: DEVELOPMENT.md, "Code graph (Graphify)".
