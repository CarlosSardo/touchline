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

<!-- _class: chart -->

# The grep relay 🏃

_"An AI club just poached my star striker. What in the game can trigger an AI transfer?"_

![w:1000](assets/grep-relay.svg)

<!--
⏱ 1:15–2:00
This is a replay of the real searches (hit counts are real, tests excluded).
Each hop depends on the previous result, so it can't be parallelised: one model turn per hop, and every turn re-sends the whole conversation.
Turn 2 also matches an unrelated decide() in sanctions.ts: homonyms cost recall. Best hand-written grep recipe: 6 commands, 78% recall.
Measured with Sonnet: 11.7 turns and 335k input tokens for this one question.
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

<!-- _class: chart -->

# Same question, one command 🎬

![w:1100](assets/graphify-demo.svg)

<!--
⏱ 2:45–4:00 (live)
Run it live in a terminal: graphify affected "executeMarketTransfer" --depth 6 --relation calls
The full chain in about half a second, file:line for every hop: the whole relay from the previous slide.
If time allows: graphify explain "payReleaseClause" (callers, callees, EXTRACTED vs INFERRED confidence),
then graphify export html --node-limit 7000 and zoom into the transfer-battles community.
Fallback if the demo fails: this animation replays the real output.
-->

---

<!-- _class: small -->

# The benchmark: one fair fight ⚖️

Two agents. **Everything is identical except one thing: the map.**

|                              | 🔎 grep agent           | 🕸️ graph agent            |
| ---------------------------- | ----------------------- | ------------------------- |
| Model, prompt, commit, tasks | same                    | same                      |
| Tools                        | `rg`, file reads, shell | same **+ `graphify` CLI** |
| Instructions                 | a good search protocol  | + a short graph protocol  |
| The prompt mentions Graphify | never                   | never                     |

**11 questions a Touchline dev really asks**, in 5 kinds:

- 🔗 **Reachability**: _"What can trigger an AI transfer?"_
- 💥 **Blast radius**: _"If I change `contractEndDate`, what breaks within 3 hops?"_
- 🧪 **Tests**: _"Which tests should I run after touching `transferProceeds`?"_
- 📝 **Change plans**: _"Plan a release-clause levy: what do I edit?"_
- 🎯 **Controls**, where grep _should_ win: _"Where is `clamp` defined?"_

Each question **3 times**, on **Sonnet** and on **Haiku**.

<!--
⏱ 4:00–4:40
The fairness points: the grep agent gets good instructions too, the prompts are identical,
and we deliberately included questions where we expected the graph to lose or break even.
-->

---

<!-- _class: chart -->

# The harness ⚙️

![w:1100](assets/harness.svg)

<!--
⏱ 4:40–5:10
Each agent gets its own git worktree of the same commit; the grep agent's PATH makes graphify "command not found".
The benchmark code (and its answer keys) is deleted from every worktree: no peeking.
We also tried the graph over MCP and via a hook that redirects searches: that's the delivery slide later.
Cost comes from the Copilot CLI's own telemetry: turns, input tokens, cost. Parallelism made iterating cheap: pilot, fix, rerun in an afternoon.
-->

---

<!-- _class: chart -->

# Ground truth: the compiler is the referee 🧑‍⚖️

![w:1100](assets/ground-truth.svg)

```ts
// ground-truth.ts: breadth-first over the compiler's call hierarchy, up to 6 hops
for (const call of ls.provideCallHierarchyIncomingCalls(file, pos))
  found.set(keyOf(call.from), depth); // "file#function" -> hop count
```

- Agents answer `{ items: [{ file, symbol }] }`; the AI-transfer key has **9 functions**
- Keys: **TypeScript LanguageService** call hierarchy, refs, imports; 3 hand-traced
- Thresholds **committed before the first run**; answers re-scorable any time

<!--
⏱ 5:10–5:40
Why the compiler: it's independent of both agents. If the keys came from Graphify, the graph agent would be graded by its own map.
Hand-traced keys: the schema-migration plan, HTTP advance → match engine, and URL → Express route.
Pre-registration: "the graph agent should use ≥30% fewer tokens with accuracy no worse than 5 points" was in git before any run.
-->

---

# Plot twist: a bug in my answer key 🐛

- _"Which tests exercise `transferProceeds`?"_ **Both agents scored 56%.** Suspicious…
- **12 out of 12 Sonnet runs** listed the **same 8 "wrong" tests**
- The question allows tests that call anything within 3 hops; those 8 hit exactly hop 3
- **My key stopped one hop short.** Off-by-one, in the answer key 🤦
- Fixed the key, re-scored the saved answers (no re-runs): **100%**

> When every agent disagrees with your key in the same way… check the key. 🧐

<!--
⏱ 5:40–6:00
Independent agents, different tools, the same "mistake": it wasn't theirs.
Re-scoring is deterministic because answers and keys are both just sets of file#symbol.
-->

---

<!-- _class: small -->

# Where it shines (Sonnet) 🚀

| 🔎 grep → 🕸️ graph                          |          Turns |            Input tokens | Cost ratio |       Accuracy |
| ------------------------------------------- | -------------: | ----------------------: | ---------: | -------------: |
| _What can trigger an AI transfer?_          | 11.7 → **2.7** |  335k → **70k** (0.21×) |  **0.41×** | 98% → **100%** |
| _Blast radius of `contractEndDate`, 3 hops_ |  8.7 → **2.0** |  269k → **53k** (0.20×) |  **0.31×** |    100% → 100% |
| _Tests exercising `transferProceeds`_       | 11.7 → **4.3** | 346k → **118k** (0.34×) |  **0.51×** |    100% → 100% |

| Kind of question: graph ÷ grep (95% CI) |          Input tokens |                  Cost |   Accuracy |
| --------------------------------------- | --------------------: | --------------------: | ---------: |
| Structural: reachability, blast radius… | **0.63×** (0.55–0.73) | **0.72×** (0.68–0.75) |      −1 pt |
| Tests to run                            | **0.34×** (0.29–0.41) | **0.51×** (0.47–0.58) |         ±0 |
| Change plans                            | **0.80×** (0.65–0.97) |     0.97× (0.85–1.10) | **+2 pts** |

> Graph-shaped questions: **3–5× fewer tokens, 2–3× cheaper**, same or better answers.

<!--
⏱ 6:00–6:45
The first two: the agent asks one question and is done in two turns. That's the whole pitch.
Cost falls less than tokens because output tokens and the fixed system prompt don't shrink.
"Structural" also includes import cycles and unused exports, where the graph loses (next slide), which is why the group ratio is milder.
-->

---

<!-- _class: chart -->

# …and where it doesn't 🧯

![w:1000](assets/task-ratios.svg)

<!--
⏱ 6:45–7:15
Green: graph-shaped questions. Grey: a wash. Red: the graph is overhead.
Import cycles: GRAPH_REPORT lists a sample of 20 short cycles and misses 5 of 18 files, so the agent writes its own script anyway.
Unused exports: one script already answers it. URL → route: the graph can't connect a URL string to its Express route.
-->

---

<!-- _class: chart -->

# Small model + map ≈ big model 💸

![w:700](assets/model-costs.svg)

7 questions × 3 runs: the graph saves **26% on Sonnet** and **19% on Haiku**

_Haiku once took the wrong recipe for "which tests?" → one extra line of instructions → 3/3 at 100%. The instructions are part of the tool._

<!--
⏱ 7:15–8:00
Cost index: the Copilot CLI's own cost accounting, scaled so Sonnet + grep = 100.
Haiku with the graph matches Sonnet without it on accuracy at about a tenth of the cost.
Caveats: 7 questions, 3 runs each, and Haiku's "which tests" number comes from the follow-up run after that instruction fix.
-->

---

# Delivery matters more than the graph 🚚

Same graph, three ways to hand it to the agent (structural questions, cost vs grep):

| Delivery                     |         Cost | Verdict                                |
| ---------------------------- | -----------: | -------------------------------------- |
| **CLI + short instructions** |    **0.72×** | ✅ one command answers the question    |
| CLI + search-redirect hook   |        0.72× | ➖ same, plus a wasted turn elsewhere  |
| MCP server                   | 🔴 **1.33×** | ❌ tool discovery + hop-by-hop walking |

> Simplest wins: a CLI the agent already knows how to call. 🧰

<!--
⏱ 8:00–8:20
MCP: the tools are deferred, so there's an extra tool_search turn, schemas ride along on every call,
and with no "affected" tool it walks get_neighbors hop by hop: 25 graph calls on the blast-radius question vs 1.
-->

---

<!-- _class: small -->

# Prompts where Graphify shines ✨

| Ask your agent…                                 | 🔎 grep agent                  | 🕸️ graph agent (measured)                                     |
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
⏱ 8:20–8:45
Rule of thumb: if the answer is a chain or a set reached through calls, ask the graph.
If the answer is one string, grep it.
-->

---

# Try it on your repo this afternoon 🏁

```bash
uv tool install graphifyy                 # or: pipx install graphifyy
graphify update .                         # build the graph: local, no LLM, seconds
graphify install --platform copilot       # teach your agent (Claude Code, Cursor, Codex… too)
graphify hook install                     # keep it fresh on every commit
```

Then ask your agent: _"What breaks if I change `yourFunction`?"_

- 💰 **3–5× fewer tokens, 2–3× cheaper** on graph-shaped questions, same or better answers
- 🤏 **Small model + map ≈ big model** at **~1/10 the cost**
- 🔒 **Free, local, deterministic**: tree-sitter, ~40 languages, nothing leaves your machine
- ⏱️ **5 minutes to try**, and you can measure it on your own repo with the same harness

<!--
⏱ 8:45–9:30
The pitch: it costs nothing to try, and the worst case is "my agent sometimes runs one extra command".
-->

---

<!-- _class: lead small -->
<!-- _paginate: false -->

# Thank you! ⚽🕸️🤖

| What               | Where                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Graphify           | [github.com/Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)                                         |
| Use cases and docs | [graphify.com/use-cases](https://graphify.com/use-cases) · [docs.graphify.com](https://docs.graphify.com)              |
| Touchline          | [github.com/CarlosSardo/touchline](https://github.com/CarlosSardo/touchline)                                           |
| This benchmark     | `scripts/bench-graphify/`: `REPORT.md`, `hypotheses.md`, `ground-truth.ts`                                             |
| Ground truth       | [TypeScript Language Service API](https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API)         |
| Parsing            | [tree-sitter](https://tree-sitter.github.io/tree-sitter/)                                                              |
| Agent              | [GitHub Copilot CLI](https://github.com/github/copilot-cli)                                                            |
| Slides             | [Marp](https://marp.app) · [marp-slide skill](https://github.com/softaworks/agent-toolkit/tree/main/skills/marp-slide) |

**Questions?**

<!--
Q&A. The benchmark lives on the chore/graphify branch until it's merged.
-->
