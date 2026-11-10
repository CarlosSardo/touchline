# Pre-registered hypotheses (benchmark v2)

Written and committed before the full agent run. [report.ts](report.ts) checks each hypothesis mechanically, with the thresholds below, and prints the verdicts at the top of [REPORT.md](REPORT.md). Thresholds are not changed after seeing results.

## Why v2

v1 ([v1/REPORT.md](v1/REPORT.md)) found no token or accuracy gain. On review, the benchmark had not given the graph a fair chance:

- Its tasks were mostly one-hop lookups that a single grep already answers.
- The instructions told agents to use the graph only to locate code and then confirm with grep, which made every graph call an extra turn.
- The graph arm's `GRAPH_REPORT.md` was never generated, because `graphify update` skips the report when the topology is unchanged.
- No arm used the MCP server or a hook.

Cost in an agent session is roughly turns × about 28k tokens of prompt prefix. So the graph only pays off when one graph command replaces several dependent searches.

v2 tests the claim where it should hold:

- **Transitive questions:** questions that need callers of callers, import cycles, or whole-repo aggregates.
- **Each arm with its own protocol:**
  - A gets equally detailed tips for efficient search.
  - The graph arms are told to treat graph output as the answer and not re-check it with grep.
  - M uses the MCP server.
  - H uses a hook that enforces graph-first.

## Retrieval ceilings known before the run (scripted mode, `results/scripted.json`)

| Task                   | Commands A / G | Tokens A / G | Context recall A / G | Note                                                                                                 |
| ---------------------- | -------------: | -----------: | -------------------: | ---------------------------------------------------------------------------------------------------- |
| H1 reachability        |          6 / 1 |  1.5k / 0.2k |           78% / 100% | grep needs one dependent search per hop                                                              |
| H2 3-hop blast radius  |          3 / 1 |  4.4k / 0.5k |           84% / 100% |                                                                                                      |
| H3 import cycles       |          1 / 1 |  3.5k / 0.9k |           100% / 72% | GRAPH_REPORT lists 13 of the 18 files in cycles; A must compute strongly connected components itself |
| H5 unused exports      |          1 / 1 |  0.6k / 1.0k |            94% / 98% | graph recipe precision is only 0.62 (it misses some cross-file references)                           |
| H4 tests within 3 hops |          2 / 1 |  0.3k / 1.0k |          100% / 100% | graph overshoots through import edges                                                                |

## Hypotheses

Ratios are graph arm ÷ arm A: the geometric mean over tasks of the per-task mean, with 95% bootstrap CIs. Accuracy is F1 for closed sets and recall for open-ended tasks; failed runs score 0. Each graph arm (G, M, H) is judged separately.

- **P1, structural tasks (H1, H2, H3, H5).** All three conditions must hold:
  - turns ratio ≤ 0.60 (at least 40% fewer turns);
  - input-token ratio ≤ 0.70 (at least 30% fewer input tokens);
  - accuracy ≥ A − 5 points.

  Expectation: clear wins on H1 and H2. H3 and H5 are at risk on accuracy because of the ceilings above, unless agents fill the gaps.

- **P2, change plans (H6, H7).** Accuracy ≥ A − 5 points. Expectation: H7 (b) callers favours the graph; H6 docs may favour grep, because the graph does not link `persistence.md`.
- **P3, control (T7).** Input tokens within ±15% of A. A one-grep lookup should cost the same in every arm.
- **P4, coverage (H4).** Graph arms score lower than A. This is a predicted loss: tests link to code through imports, so `affected` overshoots.
- **P5, cheap model (claude-haiku-5.5, H1–H3 and H5–H7, A vs the best sonnet graph arm).** Haiku with the graph matches or beats sonnet without it on structural and change-plan accuracy: the graph does the reasoning a weaker model would get wrong.

Not judged, reported only:

- T2 and T5 (v1 one-hop tasks, expected to be about even);
- T8 (string-built HTTP paths are invisible to the graph);
- retrieved tokens, task tokens, wall time and cost;
- how often each arm actually used the graph, and whether it used it first.
