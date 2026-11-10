### Findings (hand-written after the runs)

**Where Graphify pays off.** Ask it what reaches X, what breaks if X changes, or which tests exercise X. One
`graphify affected` command replaces a chain of grep-and-read hops. Sonnet with the graph-first CLI protocol (G) used
these resources against grep/read (A):

| Task                       | Input tokens | Cost  | Turns       | Accuracy     |
| -------------------------- | ------------ | ----- | ----------- | ------------ |
| H1 (reachability, 20 hops) | 0.21×        | 0.41× | 2.7 vs 11.7 | 100% vs 98%  |
| H2 (blast radius)          | 0.20×        | 0.31× | 2.0 vs 8.7  | 100% vs 100% |
| H4 (test coverage)         | 0.34×        | 0.51× | 4.3 vs 11.7 | 100% vs 100% |

Haiku showed the same pattern: H2 used 0.36× the input tokens at 100% vs 97%. Across the seven
structural, change-plan and coverage tasks, G cut cost by 26% on sonnet (45.5 vs 61.3 AIU) and by 19% on haiku
(5.7 vs 7.0 AIU; haiku H4 G from the follow-up below), at equal or better mean accuracy (98.9% vs 98.5% sonnet, 98.9% vs 98.4% haiku).

**Where it does not.**

- **Import cycles (H3).** GRAPH_REPORT.md lists a sample of 20 short cycles, so it misses 5 of the 18 cyclic
  files. Agents noticed, then wrote the same Python script that A writes directly, which makes the graph pure overhead
  (G 0.96 accuracy for 2.9× A's input). A strongly connected component computation over the `imports` and
  `imports_from` links in graph.json reproduces the key exactly (except one `import type` pair). That recipe is now in
  the instructions, but it has not been re-measured.
- **Aggregates (H5).** A cheap script is already optimal there, and the graph adds a turn.
- **Control (T7).** Small questions are neutral: G used 0.91× the input tokens.
- **HTTP string to route (T8).** The graph cannot answer this; G costs 1.10× because the agent tries the graph first.

**Delivery matters more than the graph.**

- **MCP server (M).** It was worse than plain grep almost everywhere: 1.3–1.5× cost. Its tools are deferred, so
  every session pays a `tool_search` turn plus the tool schemas. There is no `affected` equivalent, so it walks
  `get_neighbors` one hop at a time (25 graph calls on H2). And `at=` shows the call site, not the definition.
- **Graph-first hook (H).** It added nothing over the protocol. It was equal on structural tasks, cost an extra turn on
  T8, and missed one H4 run.
- **What made v1 show no gain:** a missing GRAPH_REPORT.md, instructions that told the agent to verify the graph with
  grep, and tasks that a single grep already answers.

**Corrections, made openly.**

- **H4 answer key (off by one).** The prompt asks for tests reaching `transferProceeds` "within 3 call hops" of the
  function they call, but the key stopped at test depth 3. All 12 sonnet runs in all four arms independently listed
  the same 8 extra depth-4 tests. The key was regenerated (`ground-truth.ts`, test depth ≤ 4), and saved answers were
  re-scored with `index.ts rescore` without re-running. With the original key every arm scored 0.56, so the
  pre-registered P4 "graph loses on coverage" was not supported either way.
- **Haiku H4 G scored 0.27 in 2 of 3 runs.** Haiku picked the `--relation calls` row, which lists production
  functions only, because test calls happen inside callbacks the graph does not link. A test-coverage row was added to
  the protocol (G.md and copilot-instructions.md): run the call chain from the graph, then grep test files for those
  names and confirm each call. In a follow-up run (H4 G, 3 repeats each), haiku scored 100% (3/3) at 0.78× haiku A's
  input, and sonnet scored 100% (3/3) at the same cost as before. Raw data: `followup-h4-haiku.json` and
  `followup-h4-sonnet.json`. This is a post-hoc fix, measured on one task only.
- **P1 missed its pre-registered turn threshold.** G reached 0.65× turns against a ≤0.60× target, though it met the
  token target (0.63× against ≤0.70×). Thresholds were not changed after the fact.

**Adopted in the repo.** The G protocol plus the coverage and cycle recipes replace the generic Graphify section of
`.github/copilot-instructions.md`. `graph:setup` now writes GRAPH_REPORT.md when it is missing. Not adopted: the MCP
server and the hook.
