# Touchline: Graphify versus no Graphify

Status: protocol and confirmatory-study design. An approved 16-session Opus 5.5
pilot has now run; see [measured results and deviations](graphify-results.md).
The full repeated study below has **not** run, and no causal productivity benefit
is established. This document is for the evaluator, **never agent-visible
input**. Further paid trials require a separate model/budget/privacy decision.

## 1. Question and treatment

Does local Graphify help an otherwise identical coding agent solve representative
Touchline tasks correctly, and does any saving exceed setup/refresh overhead?

Primary comparison:

| Arm | Agent access |
| --- | --- |
| A: WITHOUT | Source, ordinary search/read tools, shell, Git diff and the same approved checks. No Graphify binary, graph, cache, report, skill, hook, prompts, MCP tools or prior transcripts. |
| B: WITH | Exactly A plus the pinned local Graphify CLI and a graph of the identical task snapshot. No graph-first policy, automatic rebuild, extra hints, model calls or changed ordinary tools. |

Common prompt suffix for both arms: "Use any available permitted local tools.
Verify claims against source. Return the requested answer with file:line evidence,
or a focused patch and the checks you ran. Do not change unrelated behavior."
The runtime tool inventory, with its normal description, is the only additional
context in B. Do not tell only B where to look or force it to query the graph.
Record non-use of the graph; analyze by assigned arm (intention to treat).
An explicit graph-first assistant skill is a different treatment, not part of this
comparison. Do not pool it into these results.

Hypotheses, not results: cross-file navigation may improve; targeted one-symbol
lookup may not; inferred or missing edges, query truncation, refresh cost and large
generated client files may cancel savings. Code-only extraction does not establish
benefits for documentation/PDF semantic analysis.

## 2. What is actually installed and reviewed

Upstream: [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify).
The distribution is **graphifyy**, executable **graphify**, version **0.9.102**,
commit **59b5ab1151e031fb42e39cfc9a50bf96f2d57ae0** (default branch was `v8`).
Do not install an unrelated similarly named package or float a branch/tag.
The local [manifest](../tools/graphify/pyproject.toml) and
[lock](../tools/graphify/uv.lock) pin source/runtime dependencies and the
setuptools build constraint. Freeze the uv version and interpreter patch version
in the experiment manifest as well; package locks alone do not pin the OS.

Reviewed upstream files at that commit:

- `README.md`: installation, privacy, code-only behavior, query logging.
- `pyproject.toml`, `LICENSE`, `LICENSE-MIT`, `NOTICE`: Python >=3.10, base
  dependency/extra separation, Apache-2.0 and retained MIT portions.
- `graphify/cli.py`, `detect.py`, `extract.py`, `build.py`: detection, tree-sitter
  extraction, graph construction, clustering and local query dispatch.
- `graphify/install.py`, `skill-copilot.md`: optional project skill and always-on
  agent instructions; these were not registered.

The base package includes NetworkX, NumPy, RapidFuzz, PyYAML and tree-sitter with
many language grammars. Optional MCP, database, PDF/media, watcher, cloud-provider
and Leiden extras were not installed. Base clustering works without those extras.
This is a structural graph (symbols/imports/calls with confidence/provenance),
not proof that dynamic dispatch, SQL strings, business rules or React behavior are
fully captured. Query output is context for source verification, not ground truth.

Code extraction runs locally. Document/media semantic extraction, LLM-assisted
deduplication and labeling can invoke an assistant or provider; Cloud/database
exports create further external surfaces. The wrapper uses code-only extraction,
`GRAPHIFY_BACKEND=none`, clean runtime environment and disabled query logs.
Installation downloads dependencies but does not upload Touchline source.
No semantic extraction, provider call, database introspection or Cloud upload
was performed. Runtime environment controls are not a network sandbox; future
trials must enforce their egress policy at the runner boundary.

## 3. Freeze before any scored run

Use the following immutable source baseline for this design:

```text
SOURCE_SHA=d092fff101f7c2301309d84c301b028685867705
GRAPHIFY_SHA=59b5ab1151e031fb42e39cfc9a50bf96f2d57ae0
GRAPHIFY_VERSION=0.9.102
```

Create a signed/offline experiment manifest outside all agent workspaces containing:

| Pin | Required value |
| --- | --- |
| Integration | Full commit containing this design/wrapper/uv.lock; SHA-256 of those files and source archive |
| Fixture | Task ID, task-specific patch SHA-256, full patched-tree file manifest, prompt hash, hidden-test hash, reference-answer hash |
| Model | Actual fixed provider/model snapshot ID, endpoint, API/CLI version, context length, reasoning setting, temperature/top-p, seed if supported, max output per turn, caching mode and pricing date |
| Agent | Exact agent version, common system prompt, enabled tools/description hashes, tool versions, permissions, retry/compaction policy; no auto-routing/model upgrades |
| Dependencies | `package-lock.json`, `tools/graphify/uv.lock`, uv 0.12.17, CPython 3.12.14, `.nvmrc`-selected Node and exact npm; capture all versions |
| Machine | Immutable OS/container digest, architecture/CPU, core allocation, RAM/swap, filesystem/storage, environment allowlist and locale/timezone |
| SQL/browser | PostgreSQL 18 exact image digest, seed/fixtures and schema namespace; Playwright Chromium version only if required |
| Schedule | PRNG algorithm/seed, complete shuffled schedule saved before execution, A/B order, exclusions and stopping rule |

Auto mode is not a model pin. A mutable model alias is insufficient for a
confirmatory comparison: use a versioned backend or label the run exploratory and
record actual model identity per trial. Do not invent an underlying app model ID.
No model has been selected and no paid trials are authorized by this setup.

Suggested pre-registered limits: comprehension/impact 10 minutes, 30,000 total
model tokens and 60 tool calls; debug/implementation 25 minutes, 80,000 total model
tokens and 150 tool calls. Per turn: 8,000 output tokens maximum. All limits apply
equally to A/B; stop at the first exhausted limit. If total-token telemetry is
unavailable, mark that cap unenforceable for both arms before the pilot, retain
time/tool caps, and report tokens/cost as unavailable. Never estimate true model
tokens from characters or Graphify's approximate output budget.

Use two allocated CPU cores, 4 GiB aggregate memory, fixed swap policy, one agent
at a time, and two Graphify extraction workers. Enforce resources with a dedicated
runner/container/cgroup, not just Python worker count. Run on a test host, not the
Pi or the primary checkout. Keep evaluator checks outside the agent timer; include
agent-initiated checks in its time/tool/cost budgets. Record both separately.

## 4. Fresh contexts and corpus isolation

Export the source commit to **a new directory for every arm of every repetition**:

```sh
# Evaluator shell; CHECKOUT is the isolated integration checkout.
SOURCE_SHA=d092fff101f7c2301309d84c301b028685867705
mkdir -p "$TRIAL/work"
git -C "$CHECKOUT" archive "$SOURCE_SHA" | tar -x -C "$TRIAL/work"
```

`TRIAL` must be a new evaluator-chosen path inside a dedicated scratch root; do
not reuse a dirty directory. Do not give the agent access to `CHECKOUT` or its Git
history, which contains this evaluator document. Apply the frozen fixture patch
from an evaluator-only mount, install identical npm dependencies from the lock,
then initialize an independent Git repo/commit in `work` to track the fixture.
Its synthetic commit ID is separate from `SOURCE_SHA`; record both and the tree
hash. Neither arm has the integration branch's benchmark document, setup docs,
tool manifest, reference solutions or hidden tests.

Both runners use identical fresh HOME, cache/temp directories, user preferences,
language settings and ordinary tool inventories. Disable memory retrieval,
session history, project/global agent instructions outside the common source,
cross-session messages, connectors, user credentials and persistent model state.
Do not resume this authoring session. Never carry an answer or patch from one arm
to the next. Disable provider prompt caching if possible; otherwise record cache
reads/writes and report that residual confound. Serial task order, OS cache and
provider drift are balanced, not assumed absent.

B alone receives a read/execute-only Graphify environment and a **fresh copy**
of its graph/cache, built by the evaluator from the patched task snapshot.
Keep the environment outside the source corpus. Build using the same options as
`scripts/graphify.sh`: `GRAPHIFY_BACKEND=none`, code-only, two workers, seed 0,
isolated HOME, no query logging, same exclusions. Run from `work` with output
`work/graphify-out/`; expose a `graphify` tool for query/path/explain/affected and
an explicit safe rebuild action. Do not copy upstream skills or hooks. These
runner mounts/adapters still need implementation before trials; the development
wrapper is not a general-purpose sandbox runner.

A must not mount the Graphify executable, graph/cache or the B tool adapter.
The evaluator records a negative-control inventory before launch: no Graphify
environment variables, graph/report/manifest/skill files, hooks or Graphify tools
available to A. Filesystem allowlists prevent reading the evaluator directory,
the other arm or host HOME; simply hiding the graph in `.gitignore` is inadequate.
Block outbound network for repository tools. Any future model transport must be
separately approved and isolated from those tools; do not send source to a new
external provider just to run this experiment.

## 5. Agent-visible task prompts

Copy only the selected paragraph and common suffix into a fresh trial. No task
labels, expected files, fixture descriptions, rubric or answers are given to the
agent. IDs below are evaluator bookkeeping.

| ID / family | Exact task prompt |
| --- | --- |
| C1 comprehension | "Explain how a hosted player's request selects its private world and how the browser prevents an old account's late response from populating a new account's screen. Identify the trust key and the server and client boundaries. Do not modify code." |
| C2 navigation | "Trace the manual-save replacement warning from the Start and Settings screens to the server's deletion order. Explain the effect of loading the oldest save, an imported save and a save belonging to another career. Identify the relevant types and regression coverage. Do not modify code." |
| I1 impact | "We may change competitive registration rules. Identify the authoritative signing, registration, fixture-selection and badge boundaries, the production callers that could be affected, and a focused regression plan. Explain why signing and eligibility must remain separate. Do not modify code." |
| I2 impact | "We may add an identity-backed per-world table that older checkpoints do not contain. Identify all schema, migration, serialization and restore surfaces that must be considered, including the distinction from the account registry. Give an ordered implementation/check plan, not a patch." |
| D1 debug | "The load screen's manual-save warning can name the save being loaded as one that will be replaced, although the server preserves it. Reproduce the discrepancy, fix its root cause and add regression coverage. Preserve autosave/imported-save/other-career behavior." |
| D2 debug | "A registered player on loan is shown as fully eligible despite being blocked by the primary competition. Find the cause, fix the label precedence without weakening eligibility rules, and add regression coverage for pending review and partial competition eligibility." |
| P1 implementation | "Add a pure exported oldestPhrase(count) helper to the existing manual-save warning module. It must return 'the oldest one' for 1 and 'the N oldest' for every integer N >= 2. Wire existing warning UI to use it without changing behavior or touching persistence. Add tests; counts below 1 or non-integers are outside this helper's contract." |
| P2 implementation | "Extend the existing manual-save replacement helper with an optional fourth argument limit, defaulting to the current manual-save limit. Valid limits are positive safe integers; invalid limits must throw RangeError. Preserve kept-save protection, ordering and career/imported/autosave filtering. Do not change the server's configured save limit or UI behavior. Add focused tests." |

## 6. Evaluator-only task setup and ground truth

Before scored runs, materialize fixture patches, hidden assertions and reference
answers independently of Graphify output, run them against a reference patch and
the broken/base tree, and freeze their hashes. A reference maintainer must verify
file:line facts against the pinned source. A graph query must never generate the
answer key. The following is the concrete fixture specification, not a claim that
the fixtures or hidden tests already exist.

| Task | Fixture / independent correctness oracle |
| --- | --- |
| C1 | Unmodified source. Required evidence anchors: `server/auth.ts`, `accounts.ts`, account routing in `app.ts`, `Store.forSchema` in `db.ts`, `requestGeneration` / `accountGeneration` and resource invalidation in `src/game-context.tsx`. Five required claims: identity is `(issuer, subject)` not email/name; registry maps to unique schema; approval/empty-world handling is explicit; API world/save operations are scoped; generation changes reject stale responses. Cite an actual control flow for each claim, not just filenames. |
| C2 | Unmodified source. Expected set: `src/views/Start.tsx`, `src/views/Settings.tsx`, `src/SaveReplacement.tsx`, `src/save-rotation.ts`, `shared/api.ts`, `server/saves.ts`, `src/save-rotation.test.ts` (additional relevant files allowed). Five claims: limit 10 per career; automatic/imported saves excluded; keep protects a loaded manual slot; modified/file descending selection with oldest-first warning; warning matches server rotation. Source/test examples must substantiate each. |
| I1 | Unmodified source. Four groups for set scoring: (1) `server/eligibility.ts` (`canSign`, `reevaluateRegistrations`, `eligibleForFixture`, `competitiveRegistrationSql`); (2) direct production signing callers `systems.ts`, `market-offers.ts`, `queries.ts`; (3) production fixture SQL in `simulation.ts`; (4) pure labels in `shared/eligibility.ts`, API projections in `server/eligibility.ts`, `src/EligibilityBadge.tsx`, relevant eligibility/integration tests. Five claims: GBE/quota are registration not contract blockers; friendly/competitive distinction; existing callers use shared authority; registration refresh cadence matters; protect UI label precedence. Evaluator freezes symbol-level edges and relevant additional callers from source before trials. |
| I2 | Unmodified source. Required anchors: `schemaMigrations`, `WORLD_TABLES`, `IDENTITY_TABLES`, `ADDED_WORLD_TABLES` in `server/sql-schema.ts`; `Store.schema()` in `server/db.ts`; `server/saves.ts`, `server/save-format.ts`, migration entrypoint `scripts/db-migrate.ts`, `server/accounts.ts`. Five claims: append next unused migration/idempotently; include identity and world inventories; old checkpoint omission restores empty; restore validates/derives current schema without downgrading; registry is not world checkpoint data. Use current source, not a stale migration number in prose. |
| D1 | Start from source; mutate only the call `savesReplacedByManualSave(saves, state.careerId, load.file)` in `src/views/Start.tsx` to omit the third argument. This is a deliberately injected regression, not a claim of a current defect. Hidden cases: load oldest of ten -> next oldest; load newer -> oldest; imported/automatic/other-career keep -> same baseline; fewer than ten -> none; tied timestamps and over-limit order match server. Existing helper tests alone cannot detect missing UI wiring: hidden test must exercise/extract the actual load-screen call with its selected file, plus a user-visible warning case. |
| D2 | Start from source; move the `onLoanFromParent` return in `shared/eligibility.ts` ahead of the competition-blocking branch, but after association checks. Deliberately injected regression. Hidden cases: primary refused/not_registered -> not_registered; primary pending with nextReview -> eligible_after_requirements; non-primary-only block -> eligible loan label as original; association pending/refused retains precedence; not-contracted and ordinary eligible unchanged. Validate exact returned label/text and `eligibilityTone` behavior where relevant. |
| P1 | Start from source; remove only exported `oldestPhrase` from `src/save-rotation.ts`; replace its production imports/uses in `src/views/Start.tsx` (three uses) and `src/views/Settings.tsx` (one use) with equivalent inline wording so the fixture remains valid and behavior identical. `src/SaveReplacement.tsx` renders supplied children, not the phrase helper. Hidden assertions: 1 -> singular, 2/10/100 -> exact plural, helper exported/pure, all four warning call sites consume helper, no duplicate helper, no persistence change. Freeze the exact fixture diff before trials. |
| P2 | Unmodified source. Hidden matrix: limits 1/2/10/20, empty/below/at/over capacity, keep oldest/newest/outside rotation, ties, randomized input order, imported/automatic/other careers, missing career; explicit invalid 0/-1/1.5/NaN/Infinity/unsafe integer throws even for empty/missing-career input. Compare against an independently written array-based server-order oracle parameterized by limit. Default call results and UI remain identical; inputs never mutate. |

For patch tasks the agent sees existing source tests, not the hidden test files.
Mount hidden checks only **after** the final response, in a separate evaluator
checkout of the submitted patch. Require them to fail on the injected/base
behavior and pass on the reference. For I1/I2 freeze the relevant set before
launch; legitimate extra files are not false positives if independently verified.
Do not reward a long speculative file list.

SQL-backed checks use an isolated PostgreSQL 18, never a production save:

```sh
# Run from each throwaway trial/evaluator checkout after npm ci, using pinned Node.
npm test -- src/save-rotation.test.ts src/import-boundary.test.ts shared/player-search.test.ts
npm run test:local -- npm test -- server/eligibility.test.ts server/saves.test.ts server/accounts.test.ts server/app.test.ts
npm run lint
npm run build
```

Those are existing regression checks, not substitutes for the hidden assertions.
Select applicable suites per task before the pilot; use the same commands in A/B.
The SQL harness creates a disposable PostgreSQL 18 test target using the repository
test Compose file. Run serially on a dedicated host: its fixed local port/project
are unsuitable for concurrent unrelated jobs. SQL credentials remain local and
outside captured result records. Browser interaction checks for D1 require the
pinned Chromium/test app and synthetic data; freeze the exact test before launch.
Missing dependencies, DB or browser is an infrastructure failure, not a pass.
No live hosted authentication, Pi deployment or full simulation soak is needed.

## 7. Exact run and scoring procedure

1. Freeze manifest, prompts, reference answers, fixture diffs and hidden tests.
   Record an unscored pilot of one pair in each family only after explicit budget
   approval. Use pilot output solely to fix harness/rubric problems, then freeze
   again; exclude all pilot data from the scored run.
2. Plan **8 tasks x 6 paired repetitions = 48 pairs / 96 agent sessions** for a
   decision-making pilot study. For each task make three AB and three BA blocks,
   shuffle those six with Python `random.Random(20261104)` in task-ID order, then
   shuffle the 48 blocks using that same generator; persist the resulting JSON
   schedule. Each pair gets the identical fixture; arm order is counterbalanced.
   Do not run these sessions merely because this document exists.
3. Before each session provision the clean workspace/context, verify hashes and
   negative controls, prime ordinary dependencies identically, and apply limits.
   Build B's graph **after fixture injection**. Time build separately. Start agent
   time at prompt submission, stop at final response or first exhausted limit.
   Include Graphify calls and any explicit refresh in agent time. No evaluator
   hints, human corrections, subagents or retries; compaction policy is fixed.
4. Save append-only local transcript/tool log and final answer/diff with hashes.
   Then run independent evaluator checks, blinded to arm. Record exit codes and
   complete failure output locally; don't upload source-bearing logs.
5. Score before looking at efficiency. Comprehension: 5 frozen claim units,
   each 0 (wrong/absent), 1 (correct but unsupported/incomplete), 2 (correct with
   source evidence), scaled to 100. Impact: 50 points for the five claim units,
   30 for precision/recall F1 of frozen symbols/files, 20 for an actionable ordered
   regression plan covering all four frozen groups. False critical assertions
   cap answer score at 50. A task passes at >=80 with no critical false claim.
6. Patch tasks: 70 points = fraction of frozen hidden assertions passed,
   20 = applicable existing regression checks (equal weight per frozen suite),
   10 = blind quality checklist (2 each: focused scope, no test weakening,
   existing API compatibility, no unnecessary dependency, readable root-cause
   fix). Pass requires all hidden assertions, all applicable existing checks and
   >=8 quality points. Compile/runtime failure is a failure, even with a
   plausible explanation. Report raw assertions/suites and quality items, not
   just a composite score. Two reviewers resolve disagreements while blinded.
7. Agent timeouts, budget exhaustion and incorrect patches count as failures,
   not exclusions. Infrastructure failure is retained with a reason; rerun the
   **whole pair** in a fresh block after repair, retain the original records and
   report the exclusion count. Never selectively retry the worse arm.

Tasks are the generalization unit; repetitions measure within-task variation,
not 48 independent repositories. This small, one-repository study cannot certify
benefit for all coding tasks. To extend it, preregister additional independent
task variants rather than selectively repeating apparent wins.

## 8. Measurements, cold/warm runs and break-even

Primary endpoints: paired pass rate and correctness score. Report per-task and
per-family outcomes. Do not call a faster but less correct agent a success.

Secondary endpoints: end-to-end wall seconds, model input/output/cache/reasoning
tokens if truly observable, billed currency/cost with dated prices, tool calls
by tool and failures, source bytes returned, diff lines/files, introduced
regressions, blind quality score. Cost is null when not observable; do not equate
a subscription with zero cost. Include Graphify output in model input accounting
only as reported by the model runtime; its output token budget is approximate.

Separate the following scopes, with disjoint timers (no double-counting):

| Scope | Definition |
| --- | --- |
| Environment install | Python/uv prerequisites and dependency downloads/build; bytes downloaded, elapsed/CPU/peak aggregate RSS/disk. One-off, reported separately for A/common and B-only tooling. |
| First graph | No graph/manifest/AST cache; dependency install already done. Record file count, skipped/failed/zero-symbol files, nodes/edges, graph/cache bytes, wall/user/system seconds and aggregate process-tree RSS/CPU. |
| Cold task | Agent session on fresh context, no earlier graph queries, fresh copy of the just-built graph. Total B task cost includes the full graph build once. |
| Warm task | Fresh independent agent context, prebuilt same-revision graph/cache copied to its workspace. No answer/query-log reuse. Report agent-only time plus separately allocated build/maintenance cost. |
| No-op refresh | Rerun safe extraction without source changes; record elapsed/resources/hash differences and warnings. |
| Changed refresh | After frozen controlled add/rename/delete/caller edits, rerun safe extraction; check changed/deleted symbols and callers against source and a fresh full build. |
| Stale graph | Explicit secondary experiment: graph built before the frozen change; agent informed of the same changed-source state in both arms. Measure stale claims, detected mismatches and time until corrected. Never mix with fresh-graph primary results. |

For the cold/warm decomposition, the same primary session provides agent-only
and build-inclusive accounting; do not count these derived views as independent
agent trials. Repeated-query process warmth is a separate microbenchmark, not
model productivity. If testing actual cold filesystem cache, use dedicated VMs;
never drop host caches on this shared machine. Otherwise label cold as
application-cache cold only and counterbalance OS-cache/order effects.

Refresh microcheck specification (no model): in a synthetic copy of the task
tree add a uniquely named exported TypeScript function and caller; build/query;
rename it and update the caller; refresh/query; delete both; refresh/query.
Confirm new symbol/call edge appears, old symbol/call disappears and unrelated
symbols persist. Record automatic stale detection separately from correctness
after manual rebuild. Hash normalized node/edge content, excluding timestamps
and absolute roots; compare incremental output with an independent fresh build.
Measure refresh p50/p95 only after a separately approved repetition count, not
from one validation run. No automatic watcher/hook is part of this treatment.

Let `B` be first-build seconds, `I` install seconds, `R_j` refresh seconds after
change j, and `A_i`, `G_i` agent seconds for paired task i. Report:

```text
baseline(N) = sum(A_i)
graph_warm_agent(N) = sum(G_i)
graph_amortized(N) = B + sum(R_j) + sum(G_i)
graph_from_zero(N) = I + B + sum(R_j) + sum(G_i)
```

Break-even is the smallest N where graph total is lower **at non-inferior
correctness**, not merely faster successful examples. For approximately constant
saving s and refresh frequency f/cost R, `ceil((I+B)/(s-f*R))` is illustrative;
if the denominator is <=0 there is no modeled time break-even. Show curves for
N=1,5,10,25,50,100 with refresh frequencies 0,1/10,1/task, and label extrapolation.
Apply the same disjoint formula to money/energy only if those metrics are known.
Keep failures in capped-time analysis; report successful-only times as secondary.

## 9. Raw local result contract

Use UTF-8 JSON Lines, one record per session, plus separate install/build/refresh
records keyed by `index_id`; keep timestamps UTC, seconds, bytes and KiB explicit.
The following is a **schema-shaped template**, not a measured result:

```json
{
  "schema_version": 1,
  "experiment_id": "<manifest-sha256>",
  "run_id": "<unique>",
  "pair_id": "<task-repetition>",
  "task_id": "D1",
  "repetition": 1,
  "arm": "A|B",
  "order": "AB|BA",
  "phase": "primary|pilot|stale",
  "source_sha": "d092fff101f7c2301309d84c301b028685867705",
  "fixture_sha256": "<hash>",
  "tree_sha256": "<hash>",
  "prompt_sha256": "<hash>",
  "hidden_tests_sha256": "<evaluator-only hash>",
  "environment_manifest_sha256": "<hash>",
  "model_actual_id": "<fixed snapshot or unknown>",
  "agent_version": "<version>",
  "index_id": null,
  "graph_sha256_before": null,
  "graph_sha256_after": null,
  "graph_used": false,
  "negative_control_ok": true,
  "started_at": "<RFC3339>",
  "finished_at": "<RFC3339>",
  "agent_wall_s": null,
  "agent_user_s": null,
  "agent_system_s": null,
  "aggregate_peak_rss_kib": null,
  "tokens": {"input": null, "output": null, "cache_read": null, "cache_write": null, "reasoning": null, "source": "unavailable"},
  "cost": {"amount": null, "currency": null, "pricing_date": null, "source": "unavailable"},
  "tools": {"total": 0, "by_name": {}, "failed": 0, "source_bytes_returned": null},
  "outcome": "pass|incorrect|timeout|budget_exhausted|infrastructure_error",
  "score": null,
  "claims": [],
  "relevant_set": {"tp": null, "fp": null, "fn": null},
  "hidden": {"passed": null, "total": null},
  "regression_checks": [],
  "quality_items": [],
  "patch": {"files": null, "added": null, "deleted": null, "sha256": null},
  "transcript_sha256": "<hash>",
  "excluded_reason": null,
  "limitations": []
}
```

`index_id` is null for A. Index/resource records contain type
`install|first_build|noop_refresh|changed_refresh`, unique index ID, source/fixture
and Graphify/lock hashes, complete command hash, start/end timestamps, wall/user/
system seconds, aggregate peak RSS KiB (or unavailable), disk allocated/logical
bytes, graph/cache sizes, input/zero-symbol/skipped/failed file counts, nodes/
edges, network-policy result and stdout/stderr hashes. Keep local evidence files
separately; record paths relative to the evaluator artifact root, not credentials.
Missing metric is null with a reason, never zero; no fabricated example results.

## 10. Analysis and decision

Analyze all assigned sessions with paired differences. Report the full 2x2
pass/fail table, exact paired McNemar test, absolute pass-rate difference with a
paired confidence interval, task-level score differences, and median paired
time/cost ratios with 95% cluster-bootstrap intervals (resample task IDs first,
then repetitions within tasks; fixed seed 20261104, 10,000 resamples).
Eight clusters give fragile intervals: show per-task plots/raw rows and do not
claim broad significance. A paired permutation analysis of task-mean differences
is a useful sensitivity check. Label family slices/secondary metrics exploratory;
adjust for multiplicity or avoid binary significance claims for those slices.

Proposed decision rule to freeze before running: require the lower 95% confidence
bound of the B-A pass-rate difference above -5 percentage points, no new critical
correctness failures, and either a >=15% median warm task-time reduction or
>=15% observable token/cost reduction, with a credible amortized break-even <=25
representative tasks. Wide intervals mean inconclusive, not "no effect".
Failure of non-inferiority is not proof of harm; correctness regressions still
block adoption pending investigation.

The 48-pair plan estimates feasibility/variance; it is not guaranteed power for a
5-point margin. After the unscored pilot estimate discordance and task variance,
simulate power under the predeclared minimally useful effect (80% power, alpha
0.05), and set/approve a fixed confirmatory sample of additional independent task
variants. No optional stopping, cherry-picked tasks or unbudgeted expansion.

Report pros and cons even if B wins: index/storage/RAM cost; dependency and license
maintenance; two-worker limit versus underlying NumPy threads; incomplete dynamic
and SQL relationships; zero-symbol files and generated-client noise; query budget
truncation and extra context; staleness/rename/delete behavior; installation
portability; source-derived cache privacy; lost docs/semantic coverage in safe
mode; model/provider drift and unavailable telemetry. Distinguish tool failure
from agent misuse without excluding either from assigned-arm outcomes.

## 11. Installation smoke evidence (not benchmark results)

Observed in this isolated Linux x86_64 checkout on 2026-11-04:

| Check | Observation |
| --- | --- |
| Environment | uv 0.12.17, CPython 3.12.14; version command prints `graphify 0.9.102`; locked setup repeated successfully |
| Initial local graph | 287 code files scanned; 13,397 nodes, 33,353 edges, 532 communities; graph JSON 14,011,556 bytes |
| Coverage warning | 22 code files reported no symbols; includes generated Dagger clients and some tests/config; docs/media deliberately skipped |
| Diagnostic build timing | 50.97 s elapsed, 64.35 s user, 22.03 s system; `/usr/bin/time -v` max RSS 460,940 KiB |
| Privacy observation | `strace -f -e trace=network` around the build showed no AF_INET/AF_INET6 calls; not a guarantee about untested commands or future versions |
| Runtime isolation | A query run with a sentinel parent API key/provider setting still made no AF_INET/AF_INET6 calls and created no parent-requested query log; no `AGENTS.md` or Graphify Copilot skill was installed |
| Navigation | save-rotation query found helper, screens, warning component, shared type and tests; 1,200-token output was explicitly truncated (56/109 nodes) |
| Explain/impact | `explain canSign` resolved `server/eligibility.ts:L503`; `affected server/eligibility.ts` returned signing, query, simulation and test callers |
| Incremental smoke | Rebuilt after one wrapper edit: 286 unchanged / 1 re-extracted, 7.48 s elapsed, 13,394 nodes / 33,350 edges; output also reported three pruned deleted/excluded-source nodes. This was not a frozen-corpus equivalence test. |
| Approximate allocated disk | venv 174 MiB; graph directory 15 MiB; uv cache 88 MiB (platform/filesystem specific) |

The diagnostic build included `strace` overhead and a working tree with this
integration in progress; these are neither clean-source trial timings nor speedup
evidence. `/usr/bin/time` max RSS is not aggregate simultaneous process-tree peak.
There was an initial failed CLI invocation: `--backend none` is rejected even
though `GRAPHIFY_BACKEND=none` is supported; the wrapper now uses the environment
setting. Python 3.14 was not the tested environment; the tool pins 3.12.

At installation time, application tests/builds were not run for the
developer-tool-only change; the host Node was 22.22.1, below Touchline's required
24.11+. No Node package, application, CI, database or deployment behavior was
changed. The subsequent approved pilot used isolated Node 24 containers and
validated fixtures/oracles before trials; its checks, measurements and deviations
are recorded in [the pilot report](graphify-results.md). The installation smoke
checks alone remain insufficient evidence of productivity improvement.
