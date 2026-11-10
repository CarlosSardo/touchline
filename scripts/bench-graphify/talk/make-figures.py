#!/usr/bin/env python3
"""Generates the SVG figures used by graphify-talk.md.

Animated, in the style of Graphify's README demo (a terminal on the left, Touchline's call graph lighting up on the right):
  assets/grep-relay.svg      an agent grepping one hop per model turn (slide "The grep relay")
  assets/graphify-demo.svg   one `graphify affected` call lighting up the whole chain (slide "Demo")
Static diagrams:
  assets/harness.svg         how the benchmark runs (slide "The harness")
  assets/ground-truth.svg    how keys and scores are produced deterministically (slide "Ground truth")
  assets/score-example.svg   real answers scored against a real key (slide "Scoring, for real")

Terminal output and hit counts are real (captured on this repo); every measured number is read from ../results. SMIL animations play inside an <img> (Marp HTML,
VS Code preview, GitHub). Every animation begins at -FREEZE seconds, so static renders such as the PDF show the
finished frame.

Usage: python3 make-figures.py [--frame SECONDS]   # --frame writes paused frames to /tmp for checking
"""
import json
import math
import random
import sys
from html import escape
from pathlib import Path

W, H, SPLIT = 1200, 620, 640
FS, LH, PAD = 13.5, 25, 26
CW = FS * 0.6
BG0, BG1, EDGE, DOT = "#0c1712", "#0f1e18", "#1c2c25", "#2b3d35"
FG, DIM, GREEN, LIT, BLUE, PURPLE, RED, YELLOW = (
    "#d6e2dc", "#6f8a7f", "#4db18f", "#62c4a2", "#79c0ff", "#d2a8ff", "#f85149", "#f2cc60",
)

# Touchline's real call chain into executeMarketTransfer, by caller depth (graphify affected --depth 6).
NODES = {
    "executeMarketTransfer": (770, 488, 0),
    "decide": (712, 392, 1),
    "settleMarketBids": (858, 420, 1),
    "processTransferBattles": (790, 318, 2),
    "advance": (930, 258, 3),
    "createWorldRouter": (870, 166, 4),
    "seasonSoak": (1090, 318, 4),
    "createApp": (1010, 104, 5),
    "initialize": (1130, 58, 6),
    "start": (1128, 178, 6),
}
EDGES = [
    ("executeMarketTransfer", "decide"),
    ("executeMarketTransfer", "settleMarketBids"),
    ("decide", "processTransferBattles"),
    ("settleMarketBids", "processTransferBattles"),
    ("processTransferBattles", "advance"),
    ("advance", "createWorldRouter"),
    ("advance", "seasonSoak"),
    ("createWorldRouter", "createApp"),
    ("createApp", "initialize"),
    ("createApp", "start"),
]
HOMONYM = ("decide  (sanctions.ts)", 700, 236)
HOLD = 7  # extra seconds the finished frame stays on screen before the loop restarts

BENCH = Path(__file__).resolve().parent.parent
RESULTS = {m: json.loads((BENCH / "results" / f).read_text())["results"] for m, f in [("sonnet", "agent.json"), ("haiku", "agent-haiku.json")]}


def runs(task, arm, model="sonnet"):
    return [r for r in RESULTS[model] if r["task"] == task and r["arm"] == arm]


def measured(task="H1", model="sonnet"):
    """Mean per-run numbers for the grep agent (arm A) and the graph agent (arm G), as shown on the scorecards."""
    def mean(rs, k):
        return sum(k(r) for r in rs) / len(rs)
    a, g = runs(task, "A", model), runs(task, "G", model)
    base = mean(a, lambda r: r["nanoAiu"])
    out = {}
    for name, rs in [("grep", a), ("graph", g)]:
        out[name] = [
            ("tool calls", f"{mean(rs, lambda r: r['toolCalls']):.1f}"),
            ("model turns", f"{mean(rs, lambda r: r['modelCalls']):.1f}"),
            ("input tokens", f"{mean(rs, lambda r: r['inputTokens']) / 1000:.0f}k"),
            ("cost", f"{mean(rs, lambda r: r['nanoAiu']) / base:.2f}x"),
            ("accuracy", f"{100 * mean(rs, lambda r: r['score']['accuracy']):.0f}%"),
        ]
        out[name + "_raw"] = {
            "tokens": mean(rs, lambda r: r["inputTokens"]), "cost": mean(rs, lambda r: r["nanoAiu"]),
        }
    return out


class Anim:
    """Collects SVG elements whose visibility is driven by one shared SMIL clock."""

    def __init__(self, period: float, freeze: float, frame: float | None):
        self.period, self.freeze, self.frame = period, freeze, frame
        self.parts: list[str] = []

    def kt(self, t: float) -> float:
        return min(max(t / self.period, 0.0), 1.0)

    def animate(self, attr: str, points: list[tuple[float, str]], discrete=False) -> str:
        pts = sorted(points)
        if pts[0][0] > 0:
            pts.insert(0, (0.0, pts[0][1]))
        if pts[-1][0] < self.period:
            pts.append((self.period, pts[-1][1]))
        times, values, last = [], [], -1.0
        for t, v in pts:
            k = self.kt(t)
            k = max(k, last + 1e-4) if times else 0.0
            times.append(min(k, 1.0))
            values.append(v)
            last = k
        times[-1] = 1.0
        mode = ' calcMode="discrete"' if discrete else ""
        return (
            f'<animate attributeName="{attr}" values="{";".join(values)}" keyTimes="{";".join(f"{k:.4f}" for k in times)}"'
            f' dur="{self.period}s" begin="-{self.freeze}s" repeatCount="indefinite"{mode}/>'
        )

    def show(self, on: float, off: float | None = None, fade=0.25, level="1") -> str:
        off = self.period - 0.35 if off is None else off
        return self.animate(
            "opacity", [(0, "0"), (on, "0"), (on + fade, level), (off, level), (off + 0.3, "0")]
        )

    def svg(self, body: str) -> str:
        pause = ""
        if self.frame is not None:
            pause = (
                "<script>document.documentElement.pauseAnimations();"
                f"document.documentElement.setCurrentTime({(self.frame - self.freeze) % self.period:.3f});</script>"
            )
        return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, DejaVu Sans Mono, monospace">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BG0}"/><stop offset="1" stop-color="{BG1}"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="{LIT}" stop-opacity="0.45"/><stop offset="1" stop-color="{LIT}" stop-opacity="0"/></radialGradient>
<radialGradient id="redglow"><stop offset="0" stop-color="{RED}" stop-opacity="0.45"/><stop offset="1" stop-color="{RED}" stop-opacity="0"/></radialGradient>
</defs>
<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="14" fill="url(#bg)" stroke="#20342b" stroke-width="1.5"/>
<line x1="{SPLIT}" y1="18" x2="{SPLIT}" y2="{H - 18}" stroke="{EDGE}"/>
<circle cx="28" cy="30" r="6" fill="#ff5f56"/><circle cx="48" cy="30" r="6" fill="#ffbd2e"/><circle cx="68" cy="30" r="6" fill="#27c93f"/>
<text x="{SPLIT - 20}" y="35" text-anchor="end" font-size="13" fill="{DIM}">touchline</text>
{body}{pause}
</svg>
"""


def spans_svg(spans) -> str:
    return "".join(f'<tspan fill="{c}">{escape(t).replace(" ", "&#160;")}</tspan>' for t, c in spans)


def text(x, y, spans, size=FS, extra="", children="") -> str:
    n = sum(len(t) for t, _ in spans)
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" textLength="{n * size * 0.6:.1f}" lengthAdjust="spacing"{extra}>'
        f"{spans_svg(spans)}{children}</text>"
    )


def typed(a: Anim, x, y, spans, start, cps=32) -> tuple[str, float]:
    """A line revealed character by character, with a cursor that follows it."""
    n = sum(len(t) for t, _ in spans)
    end = start + n / cps
    widths = [(start + i / cps, f"{i * CW:.1f}") for i in range(n + 1)]
    cid = f"c{abs(hash((x, y, start))) % 10**8}"
    clip = (
        f'<clipPath id="{cid}"><rect x="{x:.1f}" y="{y - FS - 2:.1f}" height="{LH}" width="0">'
        f'{a.animate("width", [(0, "0")] + widths, discrete=True)}</rect></clipPath>'
    )
    cursor_x = [(start + i / cps, f"{x + i * CW:.1f}") for i in range(n + 1)]
    cursor = (
        f'<rect y="{y - FS + 1:.1f}" width="{CW:.1f}" height="{FS + 3}" fill="{LIT}" opacity="0">'
        f'{a.animate("x", [(0, f"{x:.1f}")] + cursor_x, discrete=True)}'
        f"{a.show(start - 0.3, end + 0.35, fade=0.01, level='0.8')}</rect>"
    )
    line = text(x, y, spans, extra=f' clip-path="url(#{cid})"')
    return clip + line + cursor, end


def command(cmd: str):
    out = []
    for i, word in enumerate(cmd.split(" ")):
        sep = " " if i else ""
        color = YELLOW if word.startswith(("'", '"')) else BLUE if word.startswith("-") else FG
        out.append((sep + word, color))
    return out


def background_graph(seed=7) -> str:
    rng = random.Random(seed)
    taken = [(x, y) for x, y, _ in NODES.values()] + [HOMONYM[1:]]
    pts = []
    for _ in range(4000):
        p = (rng.uniform(SPLIT + 30, W - 30), rng.uniform(40, H - 30))
        if all(math.dist(p, q) > 48 for q in taken + pts):
            pts.append(p)
        if len(pts) == 40:
            break
    lines = []
    for p in pts:
        for q in sorted(pts, key=lambda q: math.dist(p, q))[1:3]:
            lines.append(f'<line x1="{p[0]:.0f}" y1="{p[1]:.0f}" x2="{q[0]:.0f}" y2="{q[1]:.0f}" stroke="{EDGE}"/>')
    for a_, b_ in EDGES:
        (x1, y1, _), (x2, y2, _) = NODES[a_], NODES[b_]
        lines.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{EDGE}"/>')
    dots = [f'<circle cx="{x:.0f}" cy="{y:.0f}" r="3.5" fill="{DOT}"/>' for x, y in pts]
    dots += [f'<circle cx="{x}" cy="{y}" r="4" fill="{DOT}"/>' for x, y, _ in NODES.values()]
    return "".join(lines + dots)


def light_node(a: Anim, name: str, at: float, color=LIT, glow="glow", label=None, off=None) -> str:
    x, y, _ = NODES[name] if name in NODES else (0, 0, 0)
    label = label or name
    below = name in ("executeMarketTransfer",)
    ly = y + 26 if below else y - 14
    return (
        f'<g opacity="0">{a.show(at, off)}'
        f'<circle cx="{x}" cy="{y}" r="22" fill="url(#{glow})"/><circle cx="{x}" cy="{y}" r="6" fill="{color}"/>'
        f'<text x="{x}" y="{ly}" font-size="13" font-weight="600" fill="{FG}" text-anchor="middle">{escape(label)}</text></g>'
    )


def light_edge(a: Anim, src: str, dst: str, at: float, dur=0.35) -> str:
    (x1, y1, _), (x2, y2, _) = NODES[src], NODES[dst]
    length = math.dist((x1, y1), (x2, y2))
    return (
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{LIT}" stroke-width="2.2" stroke-dasharray="{length:.1f}" opacity="0">'
        f'{a.animate("stroke-dashoffset", [(0, f"{length:.1f}"), (at, f"{length:.1f}"), (at + dur, "0")])}'
        f"{a.show(at, fade=0.01)}</line>"
    )


def light_depth(a: Anim, depth: int, at: float) -> str:
    out = []
    for src, dst in EDGES:
        if NODES[dst][2] == depth:
            out.append(light_edge(a, src, dst, at))
    for name, (_, _, d) in NODES.items():
        if d == depth:
            out.append(light_node(a, name, at + (0.3 if depth else 0)))
    return "".join(out)


def scorecard(a: Anim, at: float, title: str, color: str, metrics, compare=None, banner="", banner_color=DIM) -> str:
    """The end-of-run panel: big measured numbers, optionally with the grep agent's numbers underneath."""
    x0, y0, w, h = PAD - 8, H - 200, SPLIT - PAD - 14, 184
    out = [
        f'<g opacity="0">{a.show(at, fade=0.35)}',
        f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="12" fill="#0a130f" stroke="{color}" stroke-width="2"/>',
        f'<text x="{x0 + 16}" y="{y0 + 28}" font-size="14" font-weight="700" fill="{color}">{escape(title)}</text>',
    ]
    col = w / len(metrics)
    for i, (label, value) in enumerate(metrics):
        cx = x0 + col * (i + 0.5)
        out.append(f'<text x="{cx:.0f}" y="{y0 + 80}" font-size="32" font-weight="800" fill="{color}" text-anchor="middle">{escape(value.replace("x", "\u00d7"))}</text>')
        out.append(f'<text x="{cx:.0f}" y="{y0 + 104}" font-size="13" fill="{FG}" text-anchor="middle">{escape(label)}</text>')
        if compare:
            out.append(f'<text x="{cx:.0f}" y="{y0 + 128}" font-size="13" fill="{YELLOW}" text-anchor="middle" opacity="0.8">vs {escape(compare[i][1].replace("x", "\u00d7"))}</text>')
    out.append(f'<text x="{x0 + w / 2:.0f}" y="{y0 + h - 18}" font-size="17" font-weight="800" fill="{banner_color}" text-anchor="middle">{escape(banner)}</text>')
    out.append("</g>")
    return "".join(out)


def counter(a: Anim, on: float, off, big: str, small: str, color: str) -> str:
    return (
        f'<g opacity="0">{a.show(on, off, fade=0.05)}'
        f'<rect x="{W - 330}" y="{H - 86}" width="312" height="68" rx="10" fill="#0a130f" opacity="0.92"/>'
        f'<text x="{W - 32}" y="{H - 52}" text-anchor="end" font-size="24" font-weight="800" fill="{color}">{escape(big)}</text>'
        f'<text x="{W - 32}" y="{H - 28}" text-anchor="end" font-size="13" fill="{DIM}">{escape(small)}</text></g>'
    )


def graphify_demo(frame):
    period = 12.0 + HOLD
    freeze = 10.0
    a = Anim(period, freeze, frame)
    body = [background_graph()]
    x, y = PAD, 78
    part, t = typed(a, x, y, [("$ ", GREEN)] + command('graphify affected "executeMarketTransfer" \\'), 0.4)
    body.append(part)
    part, t = typed(a, x, y + LH, [("    ", FG)] + command("--depth 6 --relation calls"), t + 0.1)
    body.append(part)
    t += 0.4
    rows = [
        [("Affected nodes for executeMarketTransfer()", FG)],
        [("Relations: calls   Depth: 6", DIM)],
    ]
    y += 2 * LH + 8
    for row in rows:
        body.append(f'<g opacity="0">{a.show(t)}{text(x, y, row)}</g>')
        y += LH
    body.append(light_depth(a, 0, t))
    where = {
        "decide": "server/transfer-battles.ts:L927",
        "settleMarketBids": "server/transfer-battles.ts:L1143",
        "processTransferBattles": "server/transfer-battles.ts:L1052",
        "advance": "server/simulation.ts:L3422",
        "createWorldRouter": "server/app.ts:L1793",
        "seasonSoak": "server/check-simulation.ts:L908",
        "createApp": "server/app.ts:L1183",
        "initialize": "scripts/e2e-server.ts:L52",
        "start": "server/index.ts:L75",
    }
    for depth in range(1, 7):
        at = t + 0.4 + 0.55 * (depth - 1)
        for name, (_, _, d) in NODES.items():
            if d == depth:
                row = [("- ", DIM), (f"{name}()", PURPLE), (" [calls] ", DIM), (where[name], BLUE)]
                body.append(f'<g opacity="0">{a.show(at, fade=0.12)}{text(x, y, row)}</g>')
                y += LH
        body.append(light_depth(a, depth, at))
    end = t + 0.4 + 0.55 * 5 + 0.8
    m = measured()
    tokens = m["grep_raw"]["tokens"] / m["graph_raw"]["tokens"]
    cheaper = m["grep_raw"]["cost"] / m["graph_raw"]["cost"]
    body.append(scorecard(
        a, end, "graph agent, measured on this question (Claude Sonnet 5.5, 3 runs)", LIT, m["graph"], compare=m["grep"],
        banner=f"{tokens:.1f}\u00d7 fewer tokens \u00b7 {cheaper:.1f}\u00d7 cheaper \u00b7 same answer or better", banner_color=LIT,
    ))
    body.append(counter(a, t, None, "1 tool call", "6 hops \u00b7 9 callers \u00b7 0.5 s \u00b7 0 files read", LIT))
    return a.svg("".join(body))


def grep_relay(frame):
    turns = [
        ("executeMarketTransfer", "3 hits, 1 file", "decide, settleMarketBids"),
        ("'decide|settleMarketBids'", "14 hits, 7 files", "processTransferBattles"),
        ("processTransferBattles", "3 hits, 2 files", "advance  (149 KB file)"),
        ("advance", "20 hits, 8 files", "createWorldRouter, seasonSoak"),
        ("'createWorldRouter|seasonSoak'", "5 hits, 2 files", "createApp"),
        ("createApp", "5 hits, 3 files", "start, initialize"),
    ]
    step, start = 2.15, 0.5
    end = start + step * len(turns) + 0.2
    period = start + step * len(turns) + 3.6 + HOLD
    freeze = end + 2.0
    a = Anim(period, freeze, frame)
    body = [background_graph()]
    x, y = PAD, 78
    body.append(light_depth(a, 0, 0.2))
    for i, (pattern, hits, nxt) in enumerate(turns, 1):
        s = start + step * (i - 1)
        body.append(f'<g opacity="0">{a.show(s - 0.2, fade=0.05)}{text(x, y, [(f"turn {i}", DIM)])}</g>')
        part, t = typed(a, x + 8 * CW, y, [("$ ", GREEN), ("rg -nw ", FG), (pattern, YELLOW)], s, cps=40)
        body.append(part)
        result = t + 0.75
        row = [(f"{hits:<17}", DIM), ("-> ", DIM), (nxt, PURPLE)]
        body.append(f'<g opacity="0">{a.show(result, fade=0.12)}{text(x + 8 * CW, y + LH, row)}</g>')
        body.append(light_depth(a, i, result))
        body.append(counter(
            a, s - 0.2, s + step - 0.2 if i < len(turns) else None,
            f"{i} tool call{'s' if i > 1 else ''}", f"model turn {i}: whole context re-sent", YELLOW,
        ))
        if i == 2:
            hx, hy = HOMONYM[1:]
            body.append(
                f'<g opacity="0">{a.show(result, result + 1.6, fade=0.1)}'
                f'<circle cx="{hx}" cy="{hy}" r="22" fill="url(#redglow)"/><circle cx="{hx}" cy="{hy}" r="6" fill="{RED}"/>'
                f'<text x="{hx}" y="{hy - 14}" font-size="13" font-weight="600" fill="{RED}" text-anchor="middle">{escape(HOMONYM[0])}</text>'
                f'<text x="{hx}" y="{hy + 26}" font-size="12" fill="{RED}" text-anchor="middle">same name, wrong function</text></g>'
            )
        y += 2 * LH + 6
    m = measured()
    body.append(scorecard(
        a, end, "grep agent, measured on this question (Claude Sonnet 5.5, 3 runs)", YELLOW, m["grep"],
        banner="the real agent needed even more calls than this replay", banner_color=YELLOW,
    ))
    return a.svg("".join(body))


DECK_BG, PANEL, LINE, INK, MUTED, ACCENT, HEAD, GOLD, VIOLET = (
    "#0d1117", "#161b22", "#30363d", "#e6edf3", "#8b949e", "#3fb950", "#58a6ff", "#f2cc60", "#d2a8ff",
)


def card(x, y, w, h, title, lines, color=LINE, title_color=INK, size=17) -> str:
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{PANEL}" stroke="{color}" stroke-width="2"/>']
    out.append(f'<text x="{x + 16}" y="{y + 30}" font-size="{size + 2}" font-weight="700" fill="{title_color}">{escape(title)}</text>')
    for i, line in enumerate(lines):
        out.append(f'<text x="{x + 16}" y="{y + 58 + i * 24}" font-size="{size - 1}" fill="{MUTED}">{escape(line)}</text>')
    return "".join(out)


def arrow(x1, y1, x2, y2, color=MUTED) -> str:
    return f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{color}" stroke-width="2.5" fill="none" marker-end="url(#arr)"/>'


def static_svg(w, h, body) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="JetBrains Mono, ui-monospace, Menlo, Consolas, DejaVu Sans Mono, monospace">'
        f'<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
        f'<path d="M0 0L10 5L0 10z" fill="{MUTED}"/></marker></defs>{body}</svg>\n'
    )


def badge(x, y, label, color) -> str:
    w = len(label) * 10.8 + 28
    return (
        f'<rect x="{x}" y="{y}" width="{w:.0f}" height="38" rx="19" fill="none" stroke="{color}" stroke-width="2"/>'
        f'<text x="{x + w / 2:.0f}" y="{y + 25}" font-size="18" font-weight="700" fill="{color}" text-anchor="middle">{escape(label)}</text>'
    )


def harness() -> str:
    b = [card(10, 150, 190, 120, "1 commit", ["same code", "for everyone"], color=HEAD)]
    rows = [
        ("grep agent", "graphify blocked", GOLD),
        ("graph agent: CLI", "graph + 1 command", ACCENT),
        ("graph agent: MCP", "same graph, MCP server", ACCENT),
        ("graph agent: reminder", "1st grep bounced: graph first", ACCENT),
    ]
    for i, (title, sub, color) in enumerate(rows):
        y = 20 + i * 95
        b.append(card(250, y, 330, 78, title, [sub], color=color, title_color=color, size=17))
        b.append(arrow(200, 210, 246, y + 39))
        b.append(arrow(580, y + 39, 636, 210))
    b.append(f'<text x="415" y="418" font-size="15" fill="{MUTED}" text-anchor="middle">one git worktree each, answer keys removed</text>')
    b.append(card(640, 100, 250, 220, "Copilot CLI", ["11 questions", "x 3 runs each", "Claude Sonnet 5.5", "Claude Haiku 5.5", "identical prompt"], color=HEAD))
    b.append(arrow(890, 160, 936, 105))
    b.append(arrow(890, 260, 936, 315))
    b.append(card(940, 40, 250, 95, "answer (JSON)", ["file + symbol list"], color=LINE))
    b.append(card(940, 270, 250, 95, "telemetry", ["turns, tokens, cost"], color=LINE))
    b.append(arrow(1065, 135, 1065, 176))
    b.append(card(940, 180, 250, 62, "score vs compiler", [], color=GOLD, title_color=GOLD))
    b.append(badge(10, 448, "graph built once: 14 s, no LLM", ACCENT))
    b.append(badge(430, 448, "14 sessions in parallel", HEAD))
    b.append(badge(750, 448, "132 runs in 8 min", ACCENT))
    b.append(badge(990, 448, "224 total", GOLD))
    return static_svg(1200, 496, "".join(b))


def ground_truth() -> str:
    b = [
        f'<text x="10" y="22" font-size="16" font-weight="700" fill="{HEAD}">THE KEY: computed from the code</text>',
        card(10, 36, 250, 96, "Touchline", ["commit 6cb5b3f"], color=HEAD),
        arrow(262, 84, 300, 84),
        card(304, 36, 320, 96, "TypeScript compiler", ["call hierarchy, references"], color=HEAD),
        arrow(626, 84, 664, 84),
        card(668, 36, 250, 96, "answer key", ["9 x file#function"], color=HEAD, title_color=HEAD),
        f'<text x="10" y="176" font-size="16" font-weight="700" fill="{GOLD}">THE ANSWER: whatever the agent says</text>',
        card(10, 190, 250, 96, "question", ["same prompt for all"], color=GOLD),
        arrow(262, 238, 300, 238),
        card(304, 190, 320, 96, "agent", ["grep or graph, any model"], color=GOLD),
        arrow(626, 238, 664, 238),
        card(668, 190, 250, 96, "final JSON block", ["file#function list"], color=GOLD, title_color=GOLD),
        arrow(920, 84, 968, 140),
        arrow(920, 238, 968, 184),
        card(972, 112, 218, 100, "set math", ["precision, recall", "F1 = the score"], color=ACCENT, title_color=ACCENT),
    ]
    return static_svg(1200, 296, "".join(b))


def score_example() -> str:
    """Three real runs on "what can make a rival club sign a player?", marked item by item against the real key."""
    keys = json.loads((BENCH / "answer-keys.json").read_text())["h1"]
    order = sorted(keys, key=lambda k: (NODES[k.split("#")[1]][2], k))
    picks = [
        ("grep agent", "Sonnet 5.5, run 2", runs("H1", "A", "sonnet")[1], GOLD),
        ("grep agent", "Haiku 5.5, run 1", runs("H1", "A", "haiku")[0], GOLD),
        ("graph agent", "Sonnet 5.5, run 1", runs("H1", "G", "sonnet")[0], ACCENT),
    ]
    cols = [700, 870, 1040]
    b = [
        f'<text x="20" y="34" font-size="15" fill="{MUTED}">hop</text>',
        f'<text x="72" y="34" font-size="17" font-weight="700" fill="{HEAD}">answer key (from the compiler)</text>',
    ]
    for cx, (who, run, r, color) in zip(cols, picks):
        b.append(f'<text x="{cx}" y="22" font-size="17" font-weight="700" fill="{color}" text-anchor="middle">{who}</text>')
        b.append(f'<text x="{cx}" y="44" font-size="14" fill="{MUTED}" text-anchor="middle">{run}</text>')
    marks = []
    for _, _, r, _ in picks:
        answered = {(i["file"], i.get("symbol")) for i in r["answer_items"]}
        marks.append(answered)
        assert len({f"{f}#{s}" for f, s in answered} & set(keys)) == r["score"]["correct"], "marks disagree with score.ts"
    y = 84
    for i, k in enumerate(order):
        file, sym = k.split("#")
        if i % 2 == 0:
            b.append(f'<rect x="10" y="{y - 21}" width="1180" height="30" fill="{PANEL}"/>')
        b.append(f'<text x="34" y="{y}" font-size="15" fill="{MUTED}" text-anchor="middle">{NODES[sym][2]}</text>')
        b.append(f'<text x="72" y="{y}" font-size="16" fill="{INK}"><tspan fill="{MUTED}">{escape(file)}#</tspan>{escape(sym)}</text>')
        for cx, got in zip(cols, marks):
            ok = (file, sym) in got
            b.append(f'<text x="{cx}" y="{y + 1}" font-size="20" font-weight="800" fill="{ACCENT if ok else RED}" text-anchor="middle">{"\u2713" if ok else "\u2717 missed"}</text>')
        y += 30
    extras = [sorted(f"{f}" + (f"#{s}" if s else "") for f, s in got if not s or f"{f}#{s}" not in keys) for got in marks]
    extra_label = next((e[0] for e in extras if e), "")
    b.append(f'<text x="72" y="{y}" font-size="16" fill="{RED}">extra: {escape(extra_label)} (a file, not a function)</text>')
    for cx, e in zip(cols, extras):
        b.append(f'<text x="{cx}" y="{y + 1}" font-size="20" font-weight="800" fill="{RED if e else MUTED}" text-anchor="middle">{"\u2717 wrong" if e else "\u00b7"}</text>')
    y += 22
    b.append(f'<line x1="10" y1="{y}" x2="1190" y2="{y}" stroke="{LINE}" stroke-width="2"/>')
    y += 32
    rows = [
        ("correct / answered", lambda s: f"{s['correct']} / {s['answered']}"),
        ("precision = correct / answered", lambda s: f"{s['precision']:.2f}"),
        ("recall = correct / 9", lambda s: f"{s['recall']:.2f}"),
    ]
    for label, fmt in rows:
        b.append(f'<text x="72" y="{y}" font-size="16" fill="{MUTED}">{label}</text>')
        for cx, (_, _, r, _) in zip(cols, picks):
            b.append(f'<text x="{cx}" y="{y}" font-size="17" fill="{INK}" text-anchor="middle">{fmt(r["score"])}</text>')
        y += 30
    y += 12
    b.append(f'<text x="72" y="{y}" font-size="20" font-weight="800" fill="{GOLD}">score = F1 = 2PR / (P + R)</text>')
    for cx, (_, _, r, color) in zip(cols, picks):
        b.append(f'<text x="{cx}" y="{y + 2}" font-size="28" font-weight="800" fill="{color}" text-anchor="middle">{100 * r["score"]["accuracy"]:.0f}%</text>')
    return static_svg(1200, y + 20, "".join(b))


def answer_items(text: str):
    import re
    for block in reversed(re.findall(r"```json\s*([\s\S]*?)```", text)):
        try:
            return json.loads(block)["items"]
        except (ValueError, KeyError):
            continue
    return []


for _model in RESULTS.values():
    for _r in _model:
        _r["answer_items"] = answer_items(_r.get("answer", ""))


if __name__ == "__main__":
    frame = float(sys.argv[sys.argv.index("--frame") + 1]) if "--frame" in sys.argv else None
    here = Path(__file__).parent
    if frame is None:
        for name, build in [("harness", harness), ("ground-truth", ground_truth), ("score-example", score_example)]:
            (here / "assets" / f"{name}.svg").write_text(build())
            print(here / "assets" / f"{name}.svg")
    for name, build in [("graphify-demo", graphify_demo), ("grep-relay", grep_relay)]:
        out = here / "assets" / f"{name}.svg" if frame is None else Path(f"/tmp/grev/{name}-{frame:g}.svg")
        out.write_text(build(frame))
        print(out)
