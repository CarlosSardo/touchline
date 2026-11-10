---
marp: true
theme: default
size: 16:9
paginate: true
title: Give your agent a map: Graphify on Touchline
description: A 10-minute talk and demo on what a code knowledge graph saves a coding agent, with a benchmark of 224 agent runs.
footer: "⚽ Touchline × 🕸️ Graphify"
style: |
  section {
    --accent: #3fb950;
    --heading: #58a6ff;
    --fg: #e6edf3;
    --muted: #8b949e;
    --panel: #161b22;
    --line: #30363d;
    --font-code: "JetBrains Mono", "Fira Code", "Cascadia Code", "JetBrainsMono Nerd Font Mono", "DejaVu Sans Mono", monospace;
    --borderColor-default: var(--line);
    --borderColor-muted: var(--line);
    --bgColor-default: #0d1117;
    --bgColor-muted: var(--panel);
    --fgColor-default: var(--fg);
    background: #0d1117;
    color: var(--fg);
    font-family: "Inter", "Segoe UI", "Ubuntu Sans", "Noto Sans", sans-serif;
    font-size: 26px;
    line-height: 1.45;
    padding: 44px 64px 64px 68px;
    border-left: 6px solid var(--accent);
    align-content: flex-start !important;
  }
  h1, h2 { font-family: var(--font-code); margin: 0 0 0.45em; line-height: 1.25; }
  h1 { color: var(--heading); font-size: 40px; }
  h1::before { content: "# "; color: var(--accent); }
  h2 { color: var(--muted); font-size: 26px; font-weight: 400; }
  h1 img.emoji { height: 0.9em; vertical-align: -0.1em; }
  p, ul, ol, table, pre, blockquote { margin-top: 0; margin-bottom: 0.55em; }
  li + li { margin-top: 0.15em; }
  strong { color: #f2cc60; }
  em { color: #c9d1d9; }
  a { color: var(--heading); }
  code { font-family: var(--font-code); background: var(--panel); color: #79c0ff; border-radius: 4px; padding: 0 0.25em; font-size: 0.9em; }
  pre { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; font-size: 17px; line-height: 1.4; padding: 0.7em 1em; }
  pre code { background: transparent; color: var(--fg); padding: 0; font-size: 1em; }
  table { font-size: 19px; border-collapse: collapse; }
  th, td { border: 1px solid var(--line) !important; padding: 5px 12px; }
  th { background: var(--panel) !important; color: var(--heading); }
  tr, tr:nth-child(2n) { background: #0d1117 !important; }
  blockquote { border-left: 5px solid var(--accent); color: #c9d1d9; background: var(--panel); padding: 0.45em 0.9em; font-size: 0.9em; margin-top: 0.4em; }
  blockquote p { margin: 0; }
  footer { color: #6e7681; font-size: 14px; left: 68px; bottom: 22px; }
  section::after { color: #8b949e; font-size: 14px; background: rgba(13, 17, 23, 0.85); border-radius: 6px; padding: 2px 8px; right: 24px; bottom: 18px; }
  section.lead { align-content: center !important; }
  section.lead h1 { font-size: 64px; color: var(--accent); }
  section.lead h1::before { content: ""; }
  section.lead h2 { font-size: 28px; color: #c9d1d9; }
  section.small { font-size: 22px; }
  section.small h1 { font-size: 36px; }
  section.chart p > img:not(.emoji) { display: block; margin: 0 auto 0.4em; }
  .hljs-string { color: #a5d6ff; }
  .hljs-comment { color: #8b949e; font-style: italic; }
  .hljs-keyword, .hljs-built_in { color: #ff7b72; }
  .hljs-number, .hljs-literal { color: #79c0ff; }
  .hljs-variable, .hljs-attr, .hljs-title { color: #d2a8ff; }
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _footer: "" -->

# Give your agent a map 🗺️

## What a coding agent saves when it stops grepping and starts asking a graph

**224 agent runs · 2 models · 1 compiler-derived ground truth**

Carlos Sardo · Touchline × [Graphify](https://github.com/Graphify-Labs/graphify)

<!--
⏱ 0:00–0:30
Hook: "Who here has watched an agent grep the same 150 KB file five times in a row?"
Promise: a real codebase, a fair benchmark, real numbers. Where a code graph helps, and where it doesn't.
-->

---

# Meet Touchline ⚽

![bg right:44%](assets/touchline-ui.jpg)

- A football **sporting-director** sim: you build the club, the manager picks the team
- A living, generated world: transfers, loans, youth, finances, a match engine
- TypeScript end to end: React 19 · Express 5 · PostgreSQL 18
- Self-hosted on a Raspberry Pi 4 🥧
- **262 TS files · 182k lines**; `simulation.ts` alone is **149 KB**

> A perfect agent trap: long call chains, huge files, and everything touches transfers.

<!--
⏱ 0:30–1:15
Keep it light: "It's a football manager game, but you're the person who buys players, not the coach."
The point: big files and deep call chains are exactly where agents burn tokens.
-->

---

# The grep relay 🏃

```text
Q: "What can trigger an AI transfer? List every entry point."

turn  rg -nw <pattern>                  hits          next hop
1     executeMarketTransfer             3 in 1 file   decide, settleMarketBids
2     'decide|settleMarketBids'         14 in 7       processTransferBattles  (+ an unrelated decide)
3     processTransferBattles            3 in 2        advance  (simulation.ts, 149 KB)
4     advance                           20 in 8       createWorldRouter, seasonSoak
5     'createWorldRouter|seasonSoak'    5 in 2        createApp
6     createApp                         5 in 3        start, initialize
```

- Every hop is **one model turn**, and every turn re-sends the whole context
- Best hand-written grep recipe: **6 commands, 78% recall** (homonyms hurt)
- Measured with Sonnet: **11.7 turns, 335k input tokens** for this one question

<!--
⏱ 1:15–2:00
Each hop depends on the previous result, so you can't parallelise it. That's the cost model:
turns × context size. A graph collapses the relay into one hop.
Hit counts are the real recipe (tests excluded).
-->

---

<!-- _class: small -->

# Graphify in one slide 🕸️

![bg right:32%](assets/touchline-graph.jpg)

- Parses the repo (tree-sitter AST) into `graph.json`: functions, classes, files, linked by `calls`, `imports`, `references`
- **No LLM, fully local, 14 s**: **5,653 nodes · 18,046 edges · 193 communities**
- Committed, and refreshed by a pre-commit hook

| Question                       | Command                                            |
| ------------------------------ | -------------------------------------------------- |
| What reaches X? What breaks?   | `graphify affected "X" --depth N --relation calls` |
| Who calls X, what does X call? | `graphify explain "X"`                             |
| How does A reach B?            | `graphify path "A" "B"`                            |
| Hubs, cycles, communities      | `graphify-out/GRAPH_REPORT.md`                     |

<!--
⏱ 2:00–2:45
The image on the right is Touchline: every dot is a function or file, colours are communities.
Stress: deterministic, local, no tokens spent building it. The agent only pays to read the answer.
-->

---

<!-- _class: small -->

# Live demo 🎬

```text
$ graphify affected "executeMarketTransfer" --depth 6 --relation calls     # the relay, in 0.4 s
Affected nodes for executeMarketTransfer()
- decide() [calls] server/transfer-battles.ts:L927
- settleMarketBids() [calls] server/transfer-battles.ts:L1143
- processTransferBattles() [calls] server/transfer-battles.ts:L1052
- advance() [calls] server/simulation.ts:L3422
- createWorldRouter() [calls] server/app.ts:L1793
- seasonSoak() [calls] server/check-simulation.ts:L908
- createApp() [calls] server/app.ts:L1183
- initialize() [calls] scripts/e2e-server.ts:L52
- start() [calls] server/index.ts:L75
```

```text
$ graphify explain "payReleaseClause"                     # plan a change: callers, callees, file:line
$ graphify export html --node-limit 7000                  # the pretty picture
```

<!--
⏱ 2:45–4:00 (live)
Run 1 and show it's the full chain in under half a second, with file:line for each hop.
Run 2 and point at the callers and callees, plus EXTRACTED vs INFERRED confidence.
Run 3 only if time allows: open graphify-out/graph.html and zoom into the transfer-battles community.
Fallback if the demo fails: the output on this slide is real.
-->

---

# The benchmark ⚖️

Four arms, **same commit**, **same prompt** (it never mentions Graphify):

| Arm                | What the agent gets                                                   |
| ------------------ | --------------------------------------------------------------------- |
| **A** grep/read    | `rg`, file reads, fair search tips; `graphify` is _command not found_ |
| **G** Graphify CLI | the graph + a short graph-first protocol in `copilot-instructions.md` |
| **M** Graphify MCP | the same graph through the Graphify MCP server                        |
| **H** CLI + hook   | G + a `preToolUse` hook that sends the first search to the graph      |

- **11 tasks, 5 flavours**: structural · change plans · test coverage · controls · a known blind spot
- **Pre-registered** thresholds, e.g. structural: ≥40% fewer turns, ≥30% fewer tokens, accuracy ≥ A − 5 pts

<!--
⏱ 4:00–4:40
Structural = reachability, blast radius, import cycles, unused exports. Control = "where is clamp defined?".
Blind spot = URL string → Express route.
The fairness points: A gets good instructions too, the prompts are identical, and we deliberately included
tasks where we expected the graph to lose or break even.
-->

---

<!-- _class: small -->

# The harness (geek mode) ⚙️

```text
index.ts
 -> prepareArms()   git worktree x 5 at the same commit
    +- graph        graphify update + cluster-only, copy graphify-out/ into G, M, H
    +- arm A        PATH shim: graphify = "command not found"
    +- every arm    harness deleted (no peeking at the answer keys)
 -> runAgents()     copilot -p <prompt> --output-format json --model <m> --reasoning-effort medium
                    14 concurrent sessions, each with its own COPILOT_HOME
 -> score.ts        final JSON block vs compiler keys (F1 / recall)
 -> report.ts       ratios, geometric means, 95% bootstrap CIs -> REPORT.md
```

- **132 Sonnet runs in 8 minutes**; **224 runs** in total (pilot, Sonnet, Haiku, follow-up)
- Metrics from CLI telemetry: turns, input tokens, cost (AI units), wall time
- **Task tokens** = input − turns × fixed prefix: what the _task_ pulled into context
- Scripted ceilings with no agent: best grep vs graph recipe (H1: **6 vs 1 commands, 78% vs 100% recall**)

<!--
⏱ 4:40–5:15
Parallelism is what made iterating cheap: a full run is 8 minutes, so pilot → fix → rerun was the same afternoon.
Task tokens matter because raw input is dominated by the cached system prompt (and tool schemas) resent every turn.
-->

---

# Ground truth: the compiler is the referee 🧑‍⚖️

- Answer keys from the **TypeScript LanguageService** (call hierarchy, references, imports)
- A few traced by hand, **never derived from Graphify**
- Agents end with a JSON block: `{ items: [{ file, symbol }] }`
- Closed sets score **F1**, open tasks **recall**; hallucinated paths are flagged
- **No LLM judge**: saved answers re-score against a new key without re-running agents

<!--
⏱ 5:15–5:35
Why the compiler: it's independent of both arms. If the keys came from Graphify, the graph arm would be graded by itself.
-->

---

# VAR overturned my answer key 📺

- H4: _"Which tests exercise `transferProceeds`?"_ Every arm scored **0.56**. Suspicious…
- **12/12 Sonnet runs, all 4 arms**, listed the **same 8 "wrong" tests**
- The prompt allows a test that calls a function **within 3 hops** of `transferProceeds`; the 8 tests were exactly 3 hops out
- **My key stopped one hop short** (off-by-one)
- Fixed the key, re-scored the saved answers, no re-runs: **A, G, M → 100%**, hook 88% (one bad run)

> When every agent disagrees with your key in the same way… check the key. 🧐

<!--
⏱ 5:35–6:00
This is the fun one. Independent agents, different tools, same "mistake" → it wasn't theirs.
Rescoring is deterministic because answers and keys are both just sets of file#symbol.
-->

---

<!-- _class: small -->

# Where it shines (Sonnet) 🚀

| Task                                           |    Turns A → G |      Input tokens A → G | Cost G ÷ A | Accuracy A → G |
| ---------------------------------------------- | -------------: | ----------------------: | ---------: | -------------: |
| H1 _Who can trigger an AI transfer?_           | 11.7 → **2.7** |  335k → **70k** (0.21×) |  **0.41×** | 98% → **100%** |
| H2 _Blast radius of `contractEndDate`, 3 hops_ |  8.7 → **2.0** |  269k → **53k** (0.20×) |  **0.31×** |    100% → 100% |
| H4 _Tests exercising `transferProceeds`_       | 11.7 → **4.3** | 346k → **118k** (0.34×) |  **0.51×** |    100% → 100% |

| Group: geometric mean G ÷ A (95% CI) |          Input tokens |                  Cost |   Accuracy |
| ------------------------------------ | --------------------: | --------------------: | ---------: |
| Structural (H1, H2, H3, H5)          | **0.63×** (0.55–0.73) | **0.72×** (0.68–0.75) |      −1 pt |
| Test coverage (H4)                   | **0.34×** (0.29–0.41) | **0.51×** (0.47–0.58) |         ±0 |
| Change plans (H6, H7)                | **0.80×** (0.65–0.97) |     0.97× (0.85–1.10) | **+2 pts** |

> Graph-shaped questions: **3–5× fewer tokens, 2–3× cheaper**, same or better answers.

<!--
⏱ 6:00–6:45
H1 and H2: the agent asks one question and is done in two turns. That's the whole pitch.
Cost falls less than tokens because output tokens and the fixed prefix don't shrink.
Structural includes H3 and H5, where the graph loses (next slide), which is why the group ratio is milder.
-->

---

<!-- _class: chart -->

# …and where it doesn't 🧯

![w:1000](assets/task-ratios.svg)

<!--
⏱ 6:45–7:15
Green: graph-shaped questions. Grey: a wash. Red: the graph is overhead.
H3 import cycles: GRAPH_REPORT lists a sample of 20 short cycles and misses 5 of 18 files, so the agent writes its own script anyway.
H5: one script already answers "unused exports". T8: the graph can't connect a URL string to its route.
-->

---

<!-- _class: chart -->

# Small model + map ≈ big model 💸

![w:700](assets/model-costs.svg)

7 tasks (H1–H7) × 3 repeats: the graph saves **26% on Sonnet** and **19% on Haiku**

_Haiku took the wrong recipe on H4 in 2 of 3 runs (0.27) → added a test-coverage recipe → 3/3 at 100%. The instructions are part of the tool._

<!--
⏱ 7:15–8:00
AIU = Copilot's AI-unit cost accounting. Haiku with the graph matched Sonnet without it on accuracy at about a tenth of the cost.
Caveats: 7 tasks, 3 repeats, and Haiku's H4 number comes from the post-fix follow-up run.
-->

---

# Delivery matters more than the graph 🚚

| Structural tasks, vs grep    |         Cost | Input tokens |  Task tokens | Accuracy |
| ---------------------------- | -----------: | -----------: | -----------: | -------: |
| **G** CLI + short protocol   |    **0.72×** |    **0.63×** |    **0.44×** |    −1 pt |
| **H** CLI + graph-first hook |        0.72× |        0.64× |        0.46× |    −1 pt |
| **M** MCP server             | 🔴 **1.33×** | 🔴 **1.51×** | 🔴 **2.55×** |   −3 pts |

- MCP tools are deferred: an extra **`tool_search` turn**, and schemas ride along on every call
- No `affected` in MCP: it walks `get_neighbors` **hop by hop** (25 graph calls on H2 vs 1)
- The hook tied G on structure but **cost an extra turn** where the graph can't help: **not adopted**

<!--
⏱ 8:00–8:30
The same graph, delivered three ways, gives three different outcomes. The CLI plus 20 lines of instructions won.
Bonus MCP papercut: its at= field shows the call site, not the definition.
-->

---

<!-- _class: small -->

# Prompts where Graphify shines ✨

| Ask your agent…                                 | Vanilla agent                  | With the graph (measured)                                     |
| ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| _"What can trigger X? List every entry point."_ | grep relay, 1 hop per turn     | `affected "X" --depth 6 --relation calls` · **0.21× tokens**  |
| _"If I change X, what breaks within 3 hops?"_   | grep callers of callers        | `affected "X" --depth 3 --relation calls` · **0.20× tokens**  |
| _"Which tests should I run after touching X?"_  | grep every test for every name | call chain from the graph, then grep tests · **0.34× tokens** |
| _"Plan a change to X: callers, callees, tests"_ | read 150 KB files              | `explain "X"` · **0.80× tokens, +2 pts**                      |

**Still a job for plain grep** 🔎

- _"Where is `clamp` defined?"_: one `rg` is already optimal (graph neutral, 0.91×)
- _"Which UI component calls `/api/…/advance`?"_: URL strings are invisible to the graph
- _"Every unused export"_ or _"every file in an import cycle"_: a short script wins

<!--
⏱ 8:30–9:00
Rule of thumb: if the answer is a chain or a set reached through calls, ask the graph.
If the answer is one string, grep it.
-->

---

# Takeaways 🏁

1. **Graph-shaped questions**: **3–5× fewer tokens, 2–3× cheaper**, same or better accuracy
2. **Cheap model + map ≈ expensive model without one**: Haiku + graph ≈ Sonnet + grep at **~1/10 the cost**
3. **Delivery > data**: one CLI command and a short protocol beat MCP and hooks
4. **Benchmark like a scientist**: compiler truth, pre-registered bets, and let agents audit your keys

```text
$ uv tool install graphifyy && npm run graph:setup
$ graphify affected "yourFunction" --depth 3 --relation calls
```

**Questions?** ⚽🕸️🤖 · `scripts/bench-graphify/REPORT.md`

<!--
⏱ 9:00–9:30, then Q&A. Backup slides follow: pre-registered verdicts and threats to validity.
graph:setup builds the graph, installs the pre-commit hook and writes GRAPH_REPORT.md.
-->

---

<!-- _class: small -->
<!-- _footer: "Backup · ⚽ Touchline × 🕸️ Graphify" -->

# Backup: pre-registered verdicts

| Hypothesis (fixed before running, Sonnet, G arm)                    | Measured (95% CI)                                 |     Verdict     |
| ------------------------------------------------------------------- | ------------------------------------------------- | :-------------: |
| **P1** structural: ≥40% fewer turns, ≥30% fewer tokens, acc ≥ A − 5 | turns 0.65× (0.58–0.76), tokens 0.63× (0.55–0.73) | ❌ turns missed |
| **P2** change plans: accuracy ≥ A − 5                               | +2 pts, tokens 0.80×                              |       ✅        |
| **P3** control (_where is clamp?_): tokens within ±15%              | 0.91×                                             |       ✅        |
| **P4** coverage: graph arms lose to grep (predicted)                | ±0 pts at 0.34× tokens                            |   ❌ no loss    |
| **P5** Haiku + graph accuracy ≥ Sonnet + grep                       | 99% vs 98%                                        |       ✅        |

- Thresholds were **not** moved: P1 missed on turns (0.65× vs ≤0.60×) though tokens passed
- MCP failed P1 and P3; the hook failed P2 (−5 pts) and lost 12 pts on coverage (one bad run)

---

<!-- _class: small -->
<!-- _footer: "Backup · ⚽ Touchline × 🕸️ Graphify" -->

# Backup: method and threats to validity

- **Isolation**: a git worktree per arm, same commit; graph built once and copied; harness removed; `PATH` shim in A
- **Tokens**: CLI `session.usage_checkpoint`; task tokens = input − calls × prefix (tool schemas + system)
- **Stats**: per task mean(arm) ÷ mean(A); groups use geometric means; 2,000-resample bootstrap

**Threats**

- 3 repeats per cell → wide CIs on single tasks; group ratios are the headline
- One codebase, one language; tests reach code inside callbacks the graph doesn't link
- Structural tasks are graph-shaped _by design_; controls and the blind spot show the cost elsewhere
- A's protocol is fair, not optimal; Haiku's H4 number comes from a post-hoc fix on one task
