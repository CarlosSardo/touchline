# Graphify pilot results: Touchline

**Result: this pilot does not establish a Graphify productivity benefit.** Both
arms passed 7/8 tasks and averaged 96.26/100. The Graphify-access arm finished
faster in aggregate before indexing, but used Graphify on only **one of eight
tasks**. Including fresh graph construction made that arm **29.5% slower**.
These are exploratory observations, not statistically significant or causal
claims.

The approved 16-session pilot ran on 2026-11-04, using **Opus 5.5**, with one
independent WITH/WITHOUT pair for each of the eight tasks in the
[benchmark protocol](graphify.md). No additional paid repetitions were run.
Machine-readable observations, hashes, checks and itemized scoring are in
[`graphify-results.json`](graphify-results.json).

## Aggregate observations

A is WITHOUT Graphify; B has access to a prebuilt local code graph and Graphify
tool, without a graph-first instruction or installed agent skill.

| Metric, eight tasks per arm | A: WITHOUT | B: WITH access | Observed B versus A |
| --- | ---: | ---: | --- |
| Strict task passes | 7/8 | 7/8 | No difference |
| Mean correctness score | 96.26 | 96.26 | No difference |
| Agent wall time, graph already built | 581.9 s | 470.0 s | 19.2% lower |
| Fresh graph construction | 0 s | 283.3 s | Added overhead |
| Agent plus fresh construction | 581.9 s | 753.3 s | **29.5% higher** |
| Provider input tokens, including cache | 552,041 | 599,035 | 8.5% higher |
| Provider output tokens | 37,556 | 33,952 | 9.6% lower |
| Cache-read tokens, included in input | 441,161 | 485,938 | Not additional tokens |
| Cache-write tokens, included in input | 106,012 | 108,057 | Not additional tokens |
| Provider-reported AI credits | 138.888 | 133.667 | 3.8% lower |
| Tool calls | 50 | 52 | 4.0% higher |
| Direct Graphify queries | 0 | 1 | Used on 1/8 B tasks |

Task-level medians are less dramatic than pooled totals: the median paired B/A
agent-time ratio was **0.925**, versus **1.381** with construction; the median
input-token ratio was **1.216**, and AI-credit ratio **0.953**. Long tasks
dominate pooled time, so neither pooled percentages nor these eight paired
observations should be generalized to other workloads.

AI credits are `totalNanoAiu / 1e9` from provider telemetry, not dollars or legacy
premium-request units. Monetary cost was unavailable and is recorded as `null`.
The 16 source trials consumed 272.556 reported AI credits; this excludes
source-free preflight. Cache fields must not be added to input tokens again.
Reasoning-token fields are retained as reported, not estimated.

## Per-task observations

Scores are out of 100. Times include the model client and its repository tools,
but exclude evaluator checks and, in the agent-time columns, initial indexing.
Each B construction time is charged to that task's cold-start result.

| Task | A/B score | A/B agent seconds | B build seconds | A/B input tokens | A/B AI credits | A/B calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C1 account/world and stale responses | 80 / 80 | 31.8 / 33.4 | 34.7 | 44,791 / 64,916 | 11.609 / 12.472 | 4 / 6 |
| C2 save-warning navigation | 100 / 100 | 45.1 / 54.6 | 33.9 | 41,662 / 67,562 | 14.716 / 19.177 | 4 / 5 |
| I1 registration-rule impact | 95 / 100 | 62.4 / 39.6 | 36.2 | 67,752 / 49,996 | 20.580 / 15.281 | 5 / 4 |
| I2 identity table/checkpoint impact | 100 / 95 | 52.6 / 49.1 | 35.6 | 62,830 / 77,568 | 18.561 / 17.919 | 5 / 6 |
| D1 injected load-warning defect | 100 / 100 | 127.5 / 70.4 | 36.7 | 79,641 / 159,612 | 18.013 / 22.216 | 9 / 13 |
| D2 injected loan-label defect | 95.11 / 95.11 | 58.0 / 57.1 | 32.7 | 110,253 / 64,133 | 20.357 / 17.988 | 9 / 7 |
| P1 warning helper implementation | 100 / 100 | 66.1 / 39.1 | 36.1 | 81,033 / 38,542 | 15.801 / 10.519 | 8 / 5 |
| P2 configurable replacement limit | 100 / 100 | 138.4 / 126.7 | 37.5 | 64,079 / 76,706 | 19.251 / 18.095 | 6 / 6 |

All 16 sessions completed without timeout, budget exhaustion or paid reruns.
Answer-only tasks made no source changes. Every patch passed applicable existing
unit checks, lint and production build. D2 additionally passed the selected pure
eligibility suite. SQL-backed integration and rendered-browser checks were not
provided and are **not claimed**.

Strict hidden results for A and B respectively were D1 **25/25, 25/25**,
D2 **17/18, 17/18**, P1 **6/6, 6/6**, and P2 **294/294, 294/294**.
Both D2 patches fixed the intended primary-competition precedence defect, but
also appended ` (some competitions)` to existing partial-loan badge text.
That failed the same predeclared exact-text preservation assertion in both arms.
Thus both count as strict task failures, not failures to fix the main defect.
Their quality checklists scored 9/10; the other patches scored 10/10.

The answer-score differences are explicit rubric judgments, not test failures:
both C1 answers omitted empty-world/no-autoseed provisioning and the full
unique-schema/`Store.forSchema` control flow; I1-A proposed generic badge tests
without explicit precedence combinations; I2-B named the migration entrypoint
but did not specify migration across all registered worlds. The JSON preserves
claim units, file coverage, plan coverage and reviewer rationale.

### Evaluator correction, disclosed

The original D1 oracle extracted only `const loadReplaces = ...`. Both agents
legitimately refactored this into a destructured result from a helper, so the
original extractor reported 0/25 through instrumentation errors. The correction
accepts equivalent binding shapes and evaluates the actual source expression.
It does not change the 25 behavior assertions or agent patches.

The corrected oracle still fails the injected fixture at 23/25, passes the
original reference at 25/25, and passes both submitted patches at 25/25.
Original failure records and hashes are retained alongside corrected results.
There were no agent reruns. This is a post-hoc evaluator correction, not an
undisclosed removal of unsuccessful trials.

## What happened when Graphify was actually used?

Only **C1-B** queried Graphify. No other B trial used the Graphify tool or
accessed the graph through terminal commands.

That query took 1.09 s, found 840 nodes, and displayed 45 under the agent-selected
1,500-token budget. It returned relevant account/auth/client anchors mixed with
many generated Dagger SDK symbols; the first results included SDK `Private`,
`Client` and `stale` symbols. This is an inspected example, **not** a
predeclared retrieval precision/recall score.

On C1, B obtained the same correctness score as A, took **4.9% longer** before
indexing, used **44.9% more input tokens** and **7.4% more AI credits**. With its
index build, elapsed time was about 68.1 s versus 31.8 s. One observation cannot
establish that Graphify generally hurts performance either.

The seven non-use pairs are still included under their assigned arms:
this measures the effect of **making Graphify available**, not forcing its use.
Their warm timing differences cannot honestly be attributed to graph navigation.

## Indexing, refresh and resource measurements

After agent trials, a separate network-disabled container performed model-free
measurements on another fresh copy of the same source. Source was unchanged
between five no-op refreshes. Then two tiny evaluator-owned TypeScript files
tested add, rename and delete behavior, followed by an independent fresh build.
These operations did not alter Touchline application files on this branch.

| Operation | Wall seconds | GNU time max RSS |
| --- | ---: | ---: |
| Fresh logical index | 36.91 | 453.2 MiB |
| Five no-op refreshes | 9.93, 8.22, 8.10, 8.33, 8.49 | 189.0-189.8 MiB |
| Add symbol, caller and call edge | 9.27 | 236.1 MiB |
| Rename symbol and update caller | 9.58 | 236.4 MiB |
| Delete the two sources | 10.10 | 189.0 MiB |
| Independent fresh rebuild | 35.28 | 453.7 MiB |

Median no-op refresh was **8.33 s**. The first build used 55.76 user CPU seconds
plus 4.75 system CPU seconds; the independent fresh build used 53.35 plus 3.95.
The eight trial index builds ranged from 32.66 to 37.52 s, median 35.83 s.
These are fresh **logical indexes**, not cold operating-system/page caches;
shared-host caches were not flushed. Dependencies were already installed.
Package installation/download time was not timed, so the cold comparison above
is fresh-index cost, not a complete first-ever tool installation.

All six targeted probe checks passed: added symbol, added caller, call edge,
renamed symbol, removal of old symbol, and removal of deleted-source nodes.
This tests two simple files, not complete graph accuracy over Touchline.

**Refresh consistency caveat:** the first no-op refresh removed three external
module nodes (`http`, `https`, `node:crypto`) and three edges even though source
was unchanged. After add/rename/delete, the incrementally maintained graph still
lacked those same three nodes/edges relative to a fresh build. Comparison
normalized node identity/label/source location and edge endpoints/relation/
confidence/source location, excluding community/ranking metadata.
Fresh and incremental graphs therefore were **not structurally equivalent**.
No stale probe symbols remained, but this external-reference drift is a
maintenance drawback requiring investigation before relying on refreshes.

The initial graph had 13,395 nodes / 33,352 edges. Its JSON was 14,010,955 bytes;
the maintained output directory occupied about 14.9 MiB. The installed venv
occupied about 173.8 MiB, plus 87.5 MiB uv cache, excluding the separately
installed Python runtime. Maintenance cgroup memory peaked at 540.2 MiB,
**including file cache**. GNU time max RSS is not aggregate simultaneous
process-tree RSS; neither value should be relabeled as total agent/model RAM.

### Amortization

For stable comparable tasks, a time break-even would require
`N * (t_without - t_with - refresh_per_task) > initial_build`.
This pilot provides **no defensible measured break-even**: seven B tasks did not
use Graphify, and the sole use was slower before construction. Reusing an index
avoids construction, but does not by itself establish a productivity saving.
The all-task warm aggregate is not a valid causal estimate for that formula.

## Frozen environment and procedure

| Item | Recorded value |
| --- | --- |
| Branch | `carlossardo-graphify-evaluation` |
| Application source | `d092fff101f7c2301309d84c301b028685867705` |
| Integration commit before trials | `2a771bbc108405a9030947b426d18a88c60e0aaa` |
| Graphify | `graphifyy==0.9.102`, upstream `59b5ab1151e031fb42e39cfc9a50bf96f2d57ae0` |
| Model | `claude-opus-5.5`; high reasoning; default context |
| Copilot CLI | 1.0.105 |
| Runtime | Linux x86_64; Node 24.22.1; CPython 3.12.14; Docker 29.9.3 |
| Tool image | `sha256:2eab72f365d51f5b5d57e644bb879690b6b4b777b464d46f9f8579bfabb2ab1f` |
| Per tool container | 2 CPUs, 4 GiB RAM, zero swap, 256 PIDs; nonroot; capabilities dropped; no network or Docker socket |
| Limits | Answer tasks: 600 s / 60 tools; patch tasks: 1,500 s / 150 tools; 100 s per tool; 40,000-character output; 30 AI-credit soft cap per session |

The schedule seed was `20261104`: D2 AB, D1 BA, C2 AB, P2 AB, P1 AB, I1 BA,
I2 BA, C1 BA. A/B fixtures had identical Git trees per task and identical task
prompts. The protocol and frozen manifest identify injected defects, removed
helper fixtures, prompt hashes and independent oracle validation.

Each session received a fresh source copy, Git repository, tool container,
empty model-client working directory and fresh HOME/context. The model client
could use only the benchmark terminal tool and, in B, Graphify. Logged tool
inventories and actual tool calls were checked. A had no graph, Graphify mount,
environment, hooks, instructions or prior-run context. Evaluator oracles were
unavailable during the model session. B's graph was built after fixture setup.

Repository tools were network-disabled and credential-free. Graphify ran
code-only with `GRAPHIFY_BACKEND=none`; no Graphify Cloud, semantic-model backend,
automatic skill registration or external Graphify processing was used. The
authorized Copilot service ran the agent trials; this is **not** an offline-model
benchmark. Container limits do not constrain that model service or host client.

Applicable evaluator commands, in disposable containers only:

```sh
npm test -- src/save-rotation.test.ts src/import-boundary.test.ts shared/player-search.test.ts
npm run lint
npm run build
# D2 additionally:
npm test -- server/eligibility.test.ts -t 'eligibility labels and rules \(pure\)'
```

The local audit bundle preserves `prepare.py`, `execute.py`, `invoke.py`,
`mcp_runner.py`, frozen manifest/protocol, original and corrected oracles,
validation records, scoring rubric, manual scoring and aggregation scripts.
Original source-bearing transcripts/patches and tool logs stay in the private
session artifact directory; they are not committed or published with this report.
The machine-readable result includes their hashes.
The accompanying local `audit-replay.tar.gz` bundle has SHA-256
`1ce15478eeefce16ca498e59eaab1184bd9d4bb353ffec3ba7dc3cb3ae2f19d7`.
It contains no source snapshots, generated graphs or agent transcripts.

The execution sequence was fixture/reference preparation and oracle validation,
baseline checks, serial `execute.py`, model-free `maintenance.py`, `finalize.py`
for binding correction/audit, `summarize.py`, then `score.py`. Scripts and package
manifests for the tool image are retained in the audit bundle. This is a recorded
local harness with environment-specific paths, not a supported benchmark
platform. A replay requires a new empty artifact directory, reviewed paths,
the pinned source/environment, independent oracle validation and separate
authorization for any new paid trials. Reanalysis of existing artifacts is
model-free.

## Limitations and decision

There is **one pair per task**, one repository and one unblinded reviewer,
not the protocol's confirmatory repetitions/two-reviewer design. No p-values,
confidence intervals or power claims are appropriate here. Model service
snapshots, sampling/output settings and provider-managed prompt caching could
not be fully pinned or disabled. The local image ID is immutable, but future
rebuilds of its OS packages are not guaranteed byte-identical.

The pilot substituted time/tool/AI-credit limits for unenforceable token caps,
used pure checks rather than SQL/browser integration, and evaluated D1's actual
source expression rather than rendered UI. The D1 correction and strict D2
text criterion materially affect interpretation. D1 hidden cases cover selected
sizes/keep categories; tied-order coverage also comes from the existing helper
suite, not a browser exercise. The code-only graph includes generated client
code, and this result says nothing about Graphify's optional semantic/document
features. A graph-first skill or curated generated-code exclusion would be a
**different, unrun treatment**.

**Decision supported by these observations:** keep Graphify opt-in, not an
always-on dependency or CI step. Local graph construction and the targeted
add/rename/delete probes worked, but availability did not improve strict
completion, cold overhead was substantial, the only actual query did not beat
ordinary tools, and incremental external-reference consistency needs attention.
The apparent warm aggregate saving is not evidence that Graphify caused it.
