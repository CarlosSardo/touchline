#!/usr/bin/env python3
"""Generates the SVG figures used by graphify-talk.md.

Animated, in the style of Graphify's README demo (a terminal on the left, Touchline's call graph lighting up on the right):
  assets/grep-relay.svg      an agent grepping one hop per model turn (slide "The grep relay")
  assets/graphify-demo.svg   one `graphify affected` call lighting up the whole chain (slide "Demo")
  assets/graphify-build.svg  what `graphify update .` does to a repo: scan, parse, link, cluster, write (full slide)
  assets/graphify-install.svg  what installing Graphify gives the agent: CLI, MCP server, and the skill's key passages (full slide)
  assets/harness.svg         one benchmark sweep from commit to REPORT.md, runs replayed with real times (full slide)
Static diagrams:
  assets/ground-truth.svg    how keys and scores are produced deterministically (slide "Ground truth")
  assets/payloads.svg        the prompt, its answer key and two stored run records (slide "The raw data")
  assets/score-example.svg   real answers scored against a real key (slide "Real answers, real scores")
  assets/task-ratios.svg     every question, grouped by whether the map pays off (slide "…and where it doesn't")
  assets/model-costs.svg     cost, accuracy and effort for Sonnet and Haiku with and without the map (slide "Small model + map")

Terminal output and hit counts are real (captured on this repo); every measured number is read from ../results. SMIL animations play inside an <img> (Marp HTML,
VS Code preview, GitHub). Every animation begins at -FREEZE seconds, so static renders such as the PDF show the
finished frame. Each animation also gets a <name>.live.svg copy that starts at frame 0; the HTML deck swaps it in
whenever the slide becomes active, so the animation always plays from the start.

Usage: python3 make-figures.py [--frame SECONDS]   # --frame writes paused frames to /tmp for checking
"""
import json
import math
import random
import re
import subprocess
import sys
import textwrap
from html import escape
from pathlib import Path

W, H, SPLIT = 1200, 650, 640
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
    x, y = PAD, 78
    body = []
    # Step 1: graphify query matches words to names and lists a ranked neighbourhood (real output, 3 of 51 lines).
    # It does not understand the question: the model reads the list and picks the function to trace.
    query = 'graphify query "rival club sign player transfer"'
    trace = 'graphify affected "executeMarketTransfer" --depth 6 --relation calls'
    found = 0.4 + (2 + len(query)) / 32 + 0.4
    pick = found + 2.0
    rows = [
        [(" #1 ", DIM), ("Player", PURPLE), ("  shared/types.ts:L110", BLUE)],
        [(" #6 ", DIM), (".sign()", PURPLE), ("  server/auth.ts:L321", BLUE)],
        [("#28 ", DIM), ("executeMarketTransfer()", PURPLE), ("  transfer-battles.ts:L476", BLUE)],
    ]
    notes = [
        (0, "a type, not a cause", DIM, found + 0.5),
        (1, "'sign' = JWT signing!", RED, found + 0.9),
    ]
    # Step 2: one command traces everything that reaches it.
    cmd_y = y + 4 * LH + 8
    start2 = pick + 1.1
    end = start2 + (2 + len(trace)) / 32 + 0.4 + 0.4 + 0.55 * 5 + 0.8
    period = end + 4.8 + HOLD
    a = Anim(period, end + 2.8, frame)
    body.append(background_graph())
    part, t = typed(a, x, y, [("$ ", GREEN)] + command(query), 0.4)
    body.append(part)
    for i, row in enumerate(rows):
        body.append(f'<g opacity="0">{a.show(found + 0.15 * i, fade=0.12)}{text(x, y + (i + 1) * LH, row)}</g>')
    nx = x + 40 * CW
    for i, label, color, at in notes:
        body.append(f'<g opacity="0">{a.show(at, fade=0.15)}{text(nx, y + (i + 1) * LH, [("\u2190 " + label, color)])}</g>')
    py = y + 3 * LH
    body.append(
        f'<g opacity="0">{a.show(pick, fade=0.2)}'
        f'<rect x="{x - 6}" y="{py - FS - 5}" width="{SPLIT - PAD - 22}" height="{LH}" rx="4" fill="none" stroke="{LIT}" stroke-width="1.5"/>'
        f'{text(x + 57 * CW, py, [("\u2190 agent picks", LIT)])}</g>'
    )
    body.append(light_depth(a, 0, pick))
    part, t = typed(a, x, cmd_y, [("$ ", GREEN)] + command(trace), start2)
    body.append(part)
    t += 0.4
    y = cmd_y + LH + 8
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
    m = measured()
    tokens = m["grep_raw"]["tokens"] / m["graph_raw"]["tokens"]
    cheaper = m["grep_raw"]["cost"] / m["graph_raw"]["cost"]
    body.append(scorecard(
        a, end, "graph agent, measured on the benchmark prompt (Sonnet 5.5, 3 runs)", LIT, m["graph"], compare=m["grep"],
        banner=f"{tokens:.1f}\u00d7 fewer tokens \u00b7 {cheaper:.1f}\u00d7 cheaper \u00b7 same answer or better", banner_color=LIT,
    ))
    body.append(counter(a, found, pick, "1 tool call", "960 nodes matched \u00b7 51 shown", LIT))
    body.append(counter(a, pick, start2, "model reads the list", "picks X = executeMarketTransfer", LIT))
    body.append(counter(a, t, None, "2 tool calls", "pick X \u00b7 6 hops \u00b7 9 callers \u00b7 0 files read", LIT))
    return a.svg("".join(body))


# The grep relay replays the H1 recipe hop by hop, exactly as the grep arm saw the repo at the benchmark commit.
RELAY_COMMIT = "6cb5b3fddbb74d79058c71a6c415b012829eca4b"
RELAY_SCOPE = ["server", "scripts", ":!scripts/bench-graphify", ":!*.test.ts", ":!*.test.tsx"]
RELAY_BOX = (SPLIT + 16, 52, W - 16, H - 104)
# Where each name turns up in the hits: callers are pinned at their call site, like the agent reading the hit line.
RELAY_PINS = {
    "executeMarketTransfer": ("server/transfer-battles.ts", 476),
    "decide": ("server/transfer-battles.ts", 927),
    "settleMarketBids": ("server/transfer-battles.ts", 1143),
    "processTransferBattles": ("server/transfer-battles.ts", 1052),
    "advance": ("server/simulation.ts", 3422),
    "createWorldRouter": ("server/app.ts", 1793),
    "seasonSoak": ("server/check-simulation.ts", 908),
    "createApp": ("server/app.ts", 1183),
    "initialize": ("scripts/e2e-server.ts", 52),
    "start": ("server/index.ts", 75),
}
RELAY_HOMONYM = ("server/sanctions.ts", 183)


def git(*args) -> str:
    return subprocess.run(["git", *args], cwd=BENCH.parent.parent, check=True, capture_output=True, text=True).stdout


def squarify(items, x, y, w, h):
    """Squarified treemap: items are (key, weight) sorted by weight, descending."""
    total = sum(v for _, v in items)
    rest = [(k, v * w * h / total) for k, v in items]
    out = []
    while rest:
        short = min(w, h)

        def worst(row):
            s = sum(a for _, a in row)
            return max(max(short * short * a / (s * s), s * s / (short * short * a)) for _, a in row)

        n = 1
        while n < len(rest) and worst(rest[: n + 1]) <= worst(rest[:n]):
            n += 1
        row, rest = rest[:n], rest[n:]
        s = sum(a for _, a in row)
        if w >= h:
            cw, yy = s / h, y
            for k, a in row:
                out.append((k, x, yy, cw, a / cw))
                yy += a / cw
            x, w = x + cw, w - cw
        else:
            rh, xx = s / w, x
            for k, a in row:
                out.append((k, xx, y, a / rh, rh))
                xx += a / rh
            y, h = y + rh, h - rh
    return out


def relay_haystack():
    """Every file the grep agent searched, sized by bytes, plus each hop's real hit lines."""
    files = []
    for line in git("ls-tree", "-r", "-l", RELAY_COMMIT, "--", "server", "scripts").splitlines():
        meta, path = line.split("\t")
        if not path.startswith("scripts/bench-graphify/") and not re.search(r"\.test\.tsx?$", path):
            files.append((path, int(meta.split()[3])))
    files.sort(key=lambda f: -f[1])
    x0, y0, x1, y1 = RELAY_BOX
    tiles = {k: (x, y, w, h) for k, x, y, w, h in squarify(files, x0, y0, x1 - x0, y1 - y0)}
    cache: dict[str, int] = {}

    def lines(path):
        if path not in cache:
            cache[path] = git("show", f"{RELAY_COMMIT}:{path}").count("\n")
        return cache[path]

    def hits(pattern):
        rows = git("grep", "-nwE", pattern, RELAY_COMMIT, "--", *RELAY_SCOPE).splitlines()
        return [(path, int(n)) for _, path, n, _ in (row.split(":", 3) for row in rows)]

    return files, tiles, lines, hits


def grep_relay(frame):
    turns = [
        ("executeMarketTransfer", "3 hits, 1 file", "decide, settleMarketBids", ["decide", "settleMarketBids"]),
        ("'decide|settleMarketBids'", "14 hits, 7 files", "processTransferBattles", ["processTransferBattles"]),
        ("processTransferBattles", "3 hits, 2 files", "advance  (149 KB file)", ["advance"]),
        ("advance", "20 hits, 8 files", "createWorldRouter, seasonSoak", ["createWorldRouter", "seasonSoak"]),
        ("'createWorldRouter|seasonSoak'", "5 hits, 2 files", "createApp", ["createApp"]),
        ("createApp", "5 hits, 3 files", "start, initialize", ["initialize", "start"]),
    ]
    step, start = 2.15, 0.5
    end = start + step * len(turns) + 0.2
    period = start + step * len(turns) + 3.6 + HOLD
    freeze = end + 2.0
    a = Anim(period, freeze, frame)
    files, tiles, lines, hits = relay_haystack()
    x0, y0, x1, y1 = RELAY_BOX

    def at_line(path, n, frac=0.5):
        tx, ty, tw, th = tiles[path]
        return tx + tw * frac, ty + 3 + (th - 6) * n / max(lines(path), n)

    # The haystack: no edges, just files. grep has no map, only text.
    mb = sum(s for _, s in files) / 1e6
    body = [
        f'<defs><pattern id="code" width="64" height="24" patternUnits="userSpaceOnUse">'
        + "".join(f'<line x1="{4 + 6 * (i % 3)}" y1="{4 + 4 * i}" x2="{4 + 6 * (i % 3) + ln}" y2="{4 + 4 * i}" stroke="{DOT}" stroke-width="1.3"/>'
                  for i, ln in enumerate([30, 44, 22, 38, 50, 18]))
        + '</pattern><linearGradient id="beam" x1="0" x2="1"><stop offset="0" stop-color="#f2cc60" stop-opacity="0"/>'
        '<stop offset="1" stop-color="#f2cc60" stop-opacity="0.28"/></linearGradient></defs>',
        f'<text x="{x0}" y="36" font-size="13" fill="{DIM}"><tspan fill="{FG}">{len(files)} files \u00b7 {mb:.1f} MB</tspan>'
        f' in server/ + scripts/, re-read every turn</text>',
    ]
    for path, (tx, ty, tw, th) in tiles.items():
        body.append(f'<rect x="{tx + 1.5:.1f}" y="{ty + 1.5:.1f}" width="{tw - 3:.1f}" height="{th - 3:.1f}" rx="2" fill="#0e1a15" stroke="{EDGE}"/>')
        body.append(f'<rect x="{tx + 3:.1f}" y="{ty + 3:.1f}" width="{max(tw - 6, 0):.1f}" height="{max(th - 6, 0):.1f}" fill="url(#code)" opacity="0.7"/>')
        name = path.rsplit("/", 1)[1]
        if tw > len(name) * 6.2 + 10 and th > 20:
            body.append(f'<text x="{tx + 5:.1f}" y="{ty + 14:.1f}" font-size="10.5" fill="{DIM}">{escape(name)}</text>')

    side: dict[str, int] = {}
    boxes: list[tuple[float, float, float, float]] = []

    def pin(name, at, until, color=LIT, glow="glow", where=None, note=None):
        path, n = where or RELAY_PINS[name]
        k = side.setdefault(name, sum(1 for q in side if q in RELAY_PINS and RELAY_PINS[q][0] == path))
        frac = 0.72 if k % 2 else 0.3
        px, py = at_line(path, n, frac)
        note = note or f"{path.rsplit('/', 1)[1]}:{n}"
        lw, lh = max(len(name) * 7.6, len(note) * 6.4) + 14, 36
        lx = px + 12 if px + 12 + lw < W - 12 and (frac > 0.5 or px - 12 - lw < x0) else px - 12 - lw
        ly = min(max(py - lh / 2, y0), y1 - lh)
        while any(lx < bx + bw and bx < lx + lw and ly < by + bh and by < ly + lh for bx, by, bw, bh in boxes):
            ly += lh + 4 if ly + 2 * lh + 4 < y1 else -(lh + 4)
        boxes.append((lx, ly, lw, lh))
        dot = (
            f'<circle cx="{px:.1f}" cy="{py:.1f}" r="16" fill="url(#{glow})"/>'
            f'<circle cx="{px:.1f}" cy="{py:.1f}" r="5" fill="{color}" stroke="#0a130f" stroke-width="1.5"/>'
        )
        tag = (
            f'<rect x="{lx:.1f}" y="{ly:.1f}" width="{lw:.1f}" height="{lh}" rx="6" fill="#0a130f" stroke="{color}" opacity="0.95"/>'
            f'<text x="{lx + 7:.1f}" y="{ly + 15:.1f}" font-size="12.5" font-weight="700" fill="{color}">{escape(name)}</text>'
            f'<text x="{lx + 7:.1f}" y="{ly + 29:.1f}" font-size="10.5" fill="{FG}" opacity="0.75">{escape(note)}</text>'
        )
        if where:  # a false lead: dot and tag go together
            return f'<g opacity="0">{a.show(at, until, fade=0.15)}{dot}{tag}</g>', (px, py)
        return f'<g opacity="0">{a.show(at)}{dot}</g><g opacity="0">{a.show(at, until, fade=0.15)}{tag}</g>', (px, py)

    spots = {}
    first, spots["executeMarketTransfer"] = pin("executeMarketTransfer", 0.2, start + 0.75 + (2 + len(turns[0][0]) + 7) / 40 + 0.5)
    body.append(first)
    parent = {dst: src for src, dst in EDGES}
    x, y = PAD, 78
    trail, labels = [], []
    for i, (pattern, hits_text, nxt, names) in enumerate(turns, 1):
        s = start + step * (i - 1)
        body.append(f'<g opacity="0">{a.show(s - 0.2, fade=0.05)}{text(x, y, [(f"turn {i}", DIM)])}</g>')
        part, t = typed(a, x + 8 * CW, y, [("$ ", GREEN), ("rg -nw ", FG), (pattern, YELLOW)], s, cps=40)
        body.append(part)
        result = t + 0.75
        row = [(f"{hits_text:<17}", DIM), ("-> ", DIM), (nxt, PURPLE)]
        body.append(f'<g opacity="0">{a.show(result, fade=0.12)}{text(x + 8 * CW, y + LH, row)}</g>')
        # rg sweeps the whole haystack, then the real hit lines flash in the files they were found in.
        body.append(
            f'<rect x="{W + 50}" y="{y0}" width="40" height="{y1 - y0}" fill="url(#beam)" opacity="0">'
            # Parked off-canvas between sweeps, so a renderer that ignores the fade still never shows it.
            f'{a.animate("x", [(0, f"{W + 50}"), (s - 0.01, f"{W + 50}"), (s, f"{x0 - 40}"), (result - 0.05, f"{x1 - 40}"), (result, f"{W + 50}")])}'
            f'{a.show(s, result - 0.05, fade=0.05)}</rect>'
        )
        found = hits(pattern.strip("'"))
        expect = tuple(int(v) for v in re.findall(r"\d+", hits_text))
        assert (len(found), len({p for p, _ in found})) == expect, f"turn {i}: {pattern} gave {len(found)} hits, expected {hits_text}"
        last = i == len(turns)
        off = None if last else s + step - 0.2
        for path in sorted({p for p, _ in found}):
            tx, ty, tw, th = tiles[path]
            body.append(f'<rect x="{tx + 1.5:.1f}" y="{ty + 1.5:.1f}" width="{tw - 3:.1f}" height="{th - 3:.1f}" rx="2" fill="none" stroke="{YELLOW}" stroke-width="1.5" opacity="0">{a.show(result, off, fade=0.1)}</rect>')
        for path, n in found:
            tx, ty, tw, th = tiles[path]
            _, ly = at_line(path, n)
            body.append(f'<line x1="{tx + 4:.1f}" y1="{ly:.1f}" x2="{tx + tw - 4:.1f}" y2="{ly:.1f}" stroke="{YELLOW}" stroke-width="1.6" opacity="0">{a.show(result, off, fade=0.1)}</line>')
        until = None if last else s + 2 * step - 0.2
        boxes.clear()
        for name in names:
            part, spots[name] = pin(name, result + 0.45, until)
            labels.append(part)
            (ax, ay), (bx, by) = spots[parent[name]], spots[name]
            # A hand-drawn thread between hits, not a graph edge: the agent strings the path together itself.
            bend = 0.18 * math.dist((ax, ay), (bx, by))
            nx, ny = (by - ay), -(bx - ax)
            norm = math.hypot(nx, ny) or 1
            cx, cy = (ax + bx) / 2 + nx / norm * bend, (ay + by) / 2 + ny / norm * bend
            trail.append(
                f'<path d="M{ax:.1f},{ay:.1f} Q{cx:.1f},{cy:.1f} {bx:.1f},{by:.1f}" fill="none" stroke="{LIT}" stroke-width="1.8"'
                f' stroke-dasharray="6 5" stroke-linecap="round" opacity="0">{a.show(result + 0.1, fade=0.35, level="0.9")}</path>'
            )
        if i == 2:
            boxes.clear()
            part, _ = pin("decide", result, result + 1.6, color=RED, glow="redglow", where=RELAY_HOMONYM, note="sanctions.ts:183  same name, wrong one")
            labels.append(part)
        body.append(counter(
            a, s - 0.2, s + step - 0.2 if i < len(turns) else None,
            f"{i} tool call{'s' if i > 1 else ''}", f"model turn {i}: whole context re-sent", YELLOW,
        ))
        y += 2 * LH + 6
    body.extend(trail)
    body.extend(labels)
    m = measured()
    body.append(scorecard(
        a, end, "grep agent, measured on the benchmark prompt (Sonnet 5.5, 3 runs)", YELLOW, m["grep"],
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


HARNESS_LANES = [
    ("A", "grep agent", GOLD, [
        [("+ ", MUTED), ("rg, file reads, shell", INK)],
        [("$ graphify", INK), (" → command not found", RED)],
        [("+ ", MUTED), ("good search tips", INK), ("  A.md", MUTED)],
    ]),
    ("G", "graph agent · CLI", ACCENT, [
        [("+ ", MUTED), ("rg, file reads, shell", INK)],
        [("+ ", MUTED), ("graphify-out/", ACCENT), (" + graphify CLI", INK)],
        [("+ ", MUTED), ("ask the graph first", INK), ("  G.md", MUTED)],
    ]),
    ("M", "graph agent · MCP", VIOLET, [
        [("+ ", MUTED), ("rg, file reads, shell", INK)],
        [("+ ", MUTED), ("same graph", ACCENT), (" via MCP server", INK)],
        [("+ ", MUTED), ("ask the graph first", INK), ("  M.md", MUTED)],
    ]),
]


def harness_run(frame):
    """Full-slide story of one benchmark sweep: commit, graph once, a worktree per agent, parallel runs, score, report."""
    SW, SH = 1280, 720
    # Paced for narration: each stage gets several seconds, and the finished frame stays up long enough to conclude.
    t_commit, t_graph, t_tree, t_run, t_score, t_report = 0.8, 4.5, 10.0, 17.5, 28.0, 34.5
    sweep = 8.0  # seconds the 99 real runs take to replay
    end = t_report + 2.5
    period = end + 45 + 1.2
    a = Anim(period, end + 1.0, frame)
    b = []

    def fade(on, body, off=None, f=0.3):
        return f'<g opacity="0">{a.show(on, off, fade=f)}{body}</g>'

    def tag(x, y, label, color):
        w = len(label) * 8.4 + 22
        return (f'<rect x="{x}" y="{y - 17}" width="{w:.0f}" height="24" rx="12" fill="{color}"/>'
                f'<text x="{x + w / 2:.0f}" y="{y}" font-size="14" font-weight="800" fill="{DECK_BG}" text-anchor="middle">{escape(label)}</text>')

    def box(x, y, w, h, color, fill=PANEL):
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{color}" stroke-width="2"/>'

    def line(x1, y1, x2, y2, color, dash="", head=True, width=2):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        m = f' marker-end="url(#h{color[1:]})"' if head else ""
        return f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{color}" stroke-width="{width}" fill="none"{d}{m}/>'

    # Title and stage bar.
    b.append(f'<text x="64" y="70" font-size="36" font-weight="700" fill="{HEAD}"><tspan fill="{ACCENT}"># </tspan>The harness: one fair sweep, start to finish</text>')
    stages = [("1 commit", t_commit), ("2 build graph once", t_graph), ("3 worktree per agent", t_tree),
              ("4 run in parallel", t_run), ("5 score", t_score), ("6 report", t_report)]
    sx = 64
    for i, (label, on) in enumerate(stages):
        off = stages[i + 1][1] if i + 1 < len(stages) else period
        w = len(label) * 9.6 + 34
        b.append(
            f'<rect x="{sx}" y="96" width="{w:.0f}" height="32" rx="16" stroke-width="2">'
            f'{a.animate("fill", [(0, PANEL), (on, PANEL), (on + 0.2, ACCENT), (off, ACCENT), (off + 0.2, PANEL)])}'
            f'{a.animate("stroke", [(0, LINE), (on, LINE), (on + 0.2, ACCENT)])}</rect>'
            f'<text x="{sx + w / 2:.0f}" y="117" font-size="16" font-weight="700" text-anchor="middle">'
            f'{a.animate("fill", [(0, MUTED), (on, MUTED), (on + 0.2, DECK_BG), (off, DECK_BG), (off + 0.2, ACCENT)])}{escape(label)}</text>'
        )
        if i + 1 < len(stages):
            b.append(f'<text x="{sx + w + 9:.0f}" y="117" font-size="16" fill="{LINE}">→</text>')
        sx += w + 30

    lane_y = [216 + k * 136 for k in range(3)]
    lane_h = 124

    # 1. The start: one commit of Touchline, as is.
    b.append(fade(0.2, tag(56, 180, "▶ START", ACCENT), f=0.2))
    b.append(fade(t_commit, box(56, 196, 200, 112, HEAD)
             + f'<text x="72" y="226" font-size="19" font-weight="700" fill="{INK}">1 commit</text>'
             + f'<text x="72" y="254" font-size="17" fill="{HEAD}">{RELAY_COMMIT[:7]}</text>'
             + f'<text x="72" y="280" font-size="13" fill="{MUTED}">Touchline, as is:</text>'
             + f'<text x="72" y="298" font-size="13" fill="{MUTED}">349 files</text>'))

    # 2. The graph, built once in its own worktree and copied to the graph agents.
    gy = 384
    dots = []
    rng = random.Random(5)
    for k in range(26):
        cx, cy = 156 + 64 * math.cos(k * 2.4) * math.sqrt(k / 26), gy + 100 + 26 * math.sin(k * 2.4) * math.sqrt(k / 26)
        dots.append((cx, cy, PALETTE[k % 5]))
    links = "".join(
        f'<line x1="{dots[i][0]:.1f}" y1="{dots[i][1]:.1f}" x2="{dots[j][0]:.1f}" y2="{dots[j][1]:.1f}" stroke="{LINE}"/>'
        for i, j in ((rng.randrange(26), rng.randrange(26)) for _ in range(30))
    )
    b.append(fade(t_graph - 0.8, line(156, 310, 156, gy - 4, MUTED), f=0.3))
    b.append(fade(t_graph, box(56, gy, 200, 220, ACCENT)
             + f'<text x="72" y="{gy + 28}" font-size="19" font-weight="700" fill="{ACCENT}">graph, once</text>'
             + f'<text x="72" y="{gy + 54}" font-size="14"><tspan fill="{ACCENT}">$ </tspan><tspan fill="{INK}">graphify update .</tspan></text>'))
    b.append(fade(t_graph + 0.8, links, f=1.0))
    for k, (cx, cy, color) in enumerate(dots):
        b.append(fade(t_graph + 0.6 + k * 0.06, f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.6" fill="{color}"/>', f=0.15))
    s = BUILD_STATS
    b.append(fade(t_graph + 2.6,
                  f'<text x="72" y="{gy + 158}" font-size="13" fill="{INK}">{s["nodes"]:,} nodes</text>'
                  f'<text x="72" y="{gy + 178}" font-size="13" fill="{INK}">{s["edges"]:,} edges</text>'
                  f'<text x="72" y="{gy + 204}" font-size="13" fill="{GOLD}">{s["seconds"]} s · 0 LLM tokens</text>'))

    # 3. One git worktree per agent: same commit, answer keys deleted, different tools and instructions.
    b.append(fade(t_tree - 0.3,
                  f'<text x="296" y="172" font-size="15" font-weight="700" fill="{INK}">a git worktree per agent</text>'
                  f'<text x="296" y="194" font-size="13" fill="{MUTED}">same commit · keys deleted · own tools</text>'))
    bus_x = 276
    b.append(fade(t_tree, line(256, 252, bus_x, 252, MUTED, head=False) + line(bus_x, 252, bus_x, lane_y[2] + 30, MUTED, head=False)
                  + "".join(line(bus_x, y + 30, 292, y + 30, MUTED) for y in lane_y)))
    for k, ((arm, name, color, rows), y) in enumerate(zip(HARNESS_LANES, lane_y)):
        on = t_tree + 0.4 + k * 0.9
        b.append(fade(on, box(296, y, 652, lane_h, color, fill="#0f141b")
                      + f'<text x="312" y="{y + 26}" font-size="16" font-weight="800" fill="{color}">{arm}</text>'
                      + f'<text x="334" y="{y + 26}" font-size="16" font-weight="700" fill="{INK}">{escape(name)}</text>'))
        for r, spans in enumerate(rows):
            b.append(fade(on + 0.4 + r * 0.4, f'<text x="312" y="{y + 50 + r * 20}" font-size="13">{spans_svg(spans)}</text>', f=0.2))
        # The benchmark folder (with the answer keys) is deleted from every worktree.
        ky, kon = y + 110, t_tree + 4.6 + k * 0.3
        b.append(fade(on + 1.6, f'<text x="312" y="{ky}" font-size="13" fill="{MUTED}">scripts/bench-graphify/</text>', f=0.2))
        b.append(f'<rect x="310" y="{ky - 5}" height="2" fill="{RED}" width="0">'
                 f'{a.animate("width", [(0, "0"), (kon, "0"), (kon + 0.35, "190")])}</rect>')
        b.append(fade(kon + 0.35, f'<text x="508" y="{ky}" font-size="13" font-weight="700" fill="{RED}">✗ answer keys</text>', f=0.2))
    # The graph is copied into the two graph agents' worktrees only.
    gbus = 266
    b.append(fade(t_tree + 3.4, line(256, gy + 120, gbus, gy + 120, ACCENT, "5 4", head=False)
                  + line(gbus, lane_y[1] + 70, gbus, lane_y[2] + 70, ACCENT, "5 4", head=False)
                  + "".join(line(gbus, y + 70, 292, y + 70, ACCENT, "5 4") for y in lane_y[1:])))

    # 4. The same prompt into every lane, then the sweep replayed with real run times, at most 14 in flight.
    px = 662
    b.append(fade(t_run, box(px, 148, 286, 56, HEAD)
                  + f'<text x="{px + 12}" y="170" font-size="14" font-weight="700" fill="{HEAD}">same prompt, every agent</text>'
                  + f'<text x="{px + 12}" y="192" font-size="12.5"><tspan fill="{INK}">copilot -p "&lt;question&gt;"</tspan><tspan fill="{MUTED}"> --model</tspan></text>'))
    pbus = 648
    b.append(fade(t_run + 0.6, line(px + 10, 204, px + 10, 210, HEAD, head=False) + line(px + 10, 210, pbus, 210, HEAD, head=False)
                  + line(pbus, 210, pbus, lane_y[2] + 72, HEAD, head=False)
                  + "".join(line(pbus, y + 72, 660, y + 72, HEAD) for y in lane_y)))
    tasks = sorted({r["task"] for r in RESULTS["sonnet"]}, key=lambda t: (t[0] != "H", t))
    jobs = [(t, arm, rep) for rep in (1, 2, 3) for t in tasks for arm in "AGM"]
    rec = {(r["task"], r["arm"], r["repeat"]): r for r in RESULTS["sonnet"]}
    slots, timeline = [0.0] * 14, {}
    for job in jobs:
        i = min(range(14), key=lambda k: slots[k])
        timeline[job] = (slots[i], slots[i] + rec[job]["wallMs"])
        slots[i] += rec[job]["wallMs"]
    scale = sweep / max(slots)
    t0 = t_run + 1.6
    cell, gap = 21, 4
    gx0 = 664
    worst = min(r["score"]["accuracy"] for r in rec.values() if r["arm"] in "AGM")
    for k, ((arm, _, color, _), y) in enumerate(zip(HARNESS_LANES, lane_y)):
        b.append(fade(t_run + 1.0, f'<text x="{gx0}" y="{y + 22}" font-size="12" fill="{MUTED}">11 questions × 3 runs</text>'))
        for ti, t in enumerate(tasks):
            for rep in (1, 2, 3):
                st, en = timeline[(t, arm, rep)]
                st, en = t0 + st * scale, t0 + en * scale
                acc = rec[(t, arm, rep)]["score"]["accuracy"]
                sc = t_score + 3.4 + ti * 0.15
                final = ACCENT if acc >= 0.999 else GOLD
                x, cy = gx0 + ti * (cell + gap), y + 36 + (rep - 1) * (cell + gap)
                b.append(
                    f'<rect x="{x}" y="{cy}" width="{cell}" height="{cell}" rx="4" stroke-width="1.5" opacity="0">'
                    f'{a.animate("fill", [(0, PANEL), (st, PANEL), (st + 0.05, HEAD), (en, HEAD), (en + 0.05, "#3a4350"), (sc, "#3a4350"), (sc + 0.2, final)])}'
                    f'{a.animate("stroke", [(0, LINE), (st, LINE), (st + 0.05, "#a5d6ff"), (en, "#a5d6ff"), (en + 0.05, LINE)])}'
                    f'{a.show(t_run + 1.0, fade=0.2)}</rect>'
                )
    done_times = sorted(t0 + e * scale for _, e in timeline.values())
    steps = [(0, 0)] + [(t, n + 1) for n, t in enumerate(done_times)]
    keep = [steps[0]] + [s_ for i, s_ in enumerate(steps[1:], 1) if i == len(steps) - 1 or steps[i + 1][0] - s_[0] > 0.06]
    for i, (t, n) in enumerate(keep):
        nxt = keep[i + 1][0] if i + 1 < len(keep) else period - 0.35
        vis = [(0, "0"), (t_run + 1.0, "0"), (t_run + 1.01, "1"), (nxt, "0")] if i == 0 else [(0, "0"), (t, "1"), (nxt, "0")]
        b.append(f'<text x="{gx0}" y="638" font-size="14" fill="{INK}" opacity="0">{a.animate("opacity", vis, discrete=True)}'
                 f'answers in: <tspan font-weight="800" fill="{HEAD}">{n}</tspan> / {len(jobs)} · ≤ 14 in flight</text>')
    def legend(items):
        out, lx = [f'<text x="296" y="637" font-size="12" fill="{MUTED}">{items[0]}</text>'], 296 + len(items[0]) * 7.2 + 10
        for label, color in items[1:]:
            out.append(f'<rect x="{lx:.0f}" y="626" width="12" height="12" rx="2" fill="{color}"/>'
                       f'<text x="{lx + 18:.0f}" y="637" font-size="12" fill="{MUTED}">{escape(label)}</text>')
            lx += 18 + len(label) * 7.2 + 16
        return "".join(out)
    b.append(fade(t_run + 1.0, legend(["each square = 1 run:", ("running", HEAD), ("answered", "#3a4350")]), off=t_score + 3.1))
    b.append(fade(t_score + 3.4, legend(["each square = 1 run, scored:", ("100%", ACCENT), (f"{100 * worst:.0f}–99%", GOLD)])))

    # 5. Each run leaves an answer and telemetry; the answer is scored against the compiler's key.
    ox, ow = 972, 260
    ga, gg = runs("H1", "A")[0], runs("H1", "G")[0]
    item = ga["answer_items"][0]
    b.append(fade(t_score, "".join(line(948, y + 72, 958, y + 72, MUTED, head=False) for y in lane_y)
                  + line(958, lane_y[0] + 72, 958, lane_y[2] + 72, MUTED, head=False)
                  + line(958, 236, 958, lane_y[0] + 72, MUTED, head=False)
                  + line(958, 236, ox - 4, 236, MUTED)))
    b.append(fade(t_score, box(ox, 148, ow, 132, LINE)
                  + f'<text x="{ox + 12}" y="170" font-size="14" font-weight="700" fill="{INK}">answer <tspan fill="{MUTED}" font-weight="400">(H1 · A · run 1)</tspan></text>'
                  + f'<text x="{ox + 12}" y="194" font-size="12.5" fill="{VIOLET}">{{"items": [</text>'
                  + f'<text x="{ox + 16}" y="212" font-size="11.5" fill="{INK}">{{"file": "…/{escape(item["file"].split("/")[-1])}",</text>'
                  + f'<text x="{ox + 24}" y="228" font-size="11.5" fill="{INK}">"symbol": "{escape(item["symbol"])}"}},</text>'
                  + f'<text x="{ox + 20}" y="244" font-size="12" fill="{MUTED}">… {len(ga["answer_items"]) - 1} more</text>'
                  + f'<text x="{ox + 12}" y="262" font-size="12.5" fill="{VIOLET}">]}}</text>'))
    def tele(r):
        return f'{r["toolCalls"]} tools · {r["inputTokens"] / 1000:.0f}k tok · {r["wallMs"] / 1000:.0f} s'
    b.append(fade(t_score + 1.2, box(ox, 292, ow, 98, LINE)
                  + f'<text x="{ox + 12}" y="314" font-size="14" font-weight="700" fill="{INK}">telemetry <tspan fill="{MUTED}" font-weight="400">(JSONL log)</tspan></text>'
                  + f'<text x="{ox + 12}" y="338" font-size="12" fill="{GOLD}">A <tspan fill="{INK}">{tele(ga)}</tspan></text>'
                  + f'<text x="{ox + 12}" y="358" font-size="12" fill="{ACCENT}">G <tspan fill="{INK}">{tele(gg)}</tspan></text>'
                  + f'<text x="{ox + 12}" y="378" font-size="12" fill="{MUTED}">+ turns, cost (nanoAiu)</text>'))
    sc = ga["score"]
    b.append(fade(t_score + 2.4, line(ox + ow / 2, 390, ox + ow / 2, 402, MUTED) + box(ox, 404, ow, 90, GOLD)
                  + f'<text x="{ox + 12}" y="426" font-size="14" font-weight="700" fill="{GOLD}">score vs compiler key</text>'
                  + f'<text x="{ox + 12}" y="450" font-size="12" fill="{INK}">{sc["correct"]}/{sc["answered"]} correct · {len(sc["missed"])} missed</text>'
                  + f'<text x="{ox + 12}" y="470" font-size="12" fill="{INK}">precision + recall → <tspan font-weight="800" fill="{ACCENT}">{100 * sc["accuracy"]:.0f}%</tspan></text>'
                  + f'<text x="{ox + 12}" y="486" font-size="11.5" fill="{MUTED}">no LLM in grading</text>'))

    # 6. The end: every run is one record; the report is computed from the records.
    b.append(fade(t_report, line(ox + ow / 2, 494, ox + ow / 2, 506, MUTED) + box(ox, 508, ow, 104, ACCENT)
                  + f'<text x="{ox + 12}" y="532" font-size="14" font-weight="700" fill="{ACCENT}">results/*.json</text>'
                  + f'<text x="{ox + 12}" y="552" font-size="12" fill="{INK}">answer + score + telemetry</text>'
                  + f'<text x="{ox + 12}" y="578" font-size="14" font-weight="700" fill="{ACCENT}">→ REPORT.md</text>'
                  + f'<text x="{ox + 12}" y="600" font-size="11.5" fill="{MUTED}">re-score: no model calls</text>'))
    b.append(fade(t_report + 1.5, tag(ox + ow - 76, 641, "■ END", GOLD), f=0.3))

    # Stat strip: each value lands with its stage.
    stats = [
        ("commit", RELAY_COMMIT[:7], t_commit, INK), ("graph build", f'{s["seconds"]} s', t_graph + 2.6, ACCENT),
        ("agents", "3", t_tree + 0.4, INK), ("questions × runs", "11 × 3", t_run + 1.0, INK), ("in parallel", "14", t0, HEAD),
        ("Sonnet sweep", "≈ 8 min", t0 + sweep, INK), ("runs in total", "224", t_report + 0.8, GOLD), ("LLM in grading", "0", t_score + 2.4, GOLD),
    ]
    cw = (SW - 112) / len(stats)
    b.append(f'<rect x="56" y="656" width="{SW - 112}" height="58" rx="10" fill="{PANEL}" stroke="{LINE}"/>')
    for k, (label, value, on, color) in enumerate(stats):
        x = 56 + cw * (k + 0.5)
        b.append(f'<text x="{x:.0f}" y="690" font-size="24" font-weight="800" fill="{MUTED}" text-anchor="middle" opacity="0">'
                 f'{a.animate("opacity", [(0, "1"), (on, "0")], discrete=True)}–</text>')
        b.append(fade(on, f'<text x="{x:.0f}" y="690" font-size="24" font-weight="800" fill="{color}" text-anchor="middle">{escape(value)}</text>', f=0.2))
        b.append(f'<text x="{x:.0f}" y="707" font-size="12" fill="{MUTED}" text-anchor="middle">{label}</text>')

    heads = "".join(
        f'<marker id="h{c[1:]}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="{c}"/></marker>'
        for c in (MUTED, ACCENT, HEAD)
    )
    pause = ""
    if frame is not None:
        pause = (
            "<script>document.documentElement.pauseAnimations();"
            f"document.documentElement.setCurrentTime({(frame - a.freeze) % a.period:.3f});</script>"
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SW} {SH}" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, DejaVu Sans Mono, monospace">'
        f'<defs>{heads}</defs><rect width="{SW}" height="{SH}" fill="{DECK_BG}"/><rect width="6" height="{SH}" fill="{ACCENT}"/>'
        f'{"".join(b)}{pause}</svg>\n'
    )


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


def task_prompt(task_id: str) -> tuple[str, str]:
    """The question and the answer-format rule exactly as tasks.ts sends them to every agent."""
    src = (BENCH / "tasks.ts").read_text()
    q = re.search(rf'id: "{task_id}",[\s\S]*?question:\s*"((?:[^"\\]|\\.)*)"', src).group(1)
    fmt = re.search(r"ANSWER_FORMAT = `((?:[^`\\]|\\.)*)`", src).group(1).replace("\\`", "`")
    return q, fmt


def payloads() -> str:
    """The raw JSON behind the scoring: the prompt, the compiler's answer key and two stored run records (the same runs score-example marks)."""
    key_file = json.loads((BENCH / "answer-keys.json").read_text())
    keys = key_file["h1"]
    question, fmt = task_prompt("H1")
    grep_run, graph_run = runs("H1", "A", "sonnet")[1], runs("H1", "G", "sonnet")[0]
    fs, lh, ilh = 14, 19, 17
    P, S, N, F = DIM, FG, PURPLE, VIOLET  # punctuation, strings, numbers, the answer format

    def line(x, y, spans, fs=fs):
        out = []
        for t, c, *bold in spans:
            w = ' font-weight="800"' if bold else ""
            out.append(f'<tspan fill="{c}"{w}>{escape(t).replace(" ", "&#160;")}</tspan>')
        return f'<text x="{x}" y="{y}" font-size="{fs}">{"".join(out)}</text>'

    def k(name, color=BLUE):
        return [(f'"{name}"', color), (": ", P)]

    def panel(x, y, w, h, step, name, note, color):
        return (
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{PANEL}" stroke="{color}" stroke-width="2"/>'
            f'<path d="M{x} {y + 34} H{x + w}" stroke="{LINE}"/>'
            f'<circle cx="{x + 27}" cy="{y + 17}" r="11" fill="{color}"/>'
            f'<text x="{x + 27}" y="{y + 22}" font-size="14" font-weight="800" fill="{DECK_BG}" text-anchor="middle">{step}</text>'
            f'<text x="{x + 46}" y="{y + 23}" font-size="15" font-weight="700" fill="{INK}">{escape(name)}</text>'
            f'<text x="{x + w - 16}" y="{y + 23}" font-size="15" font-weight="700" fill="{color}" text-anchor="end">{escape(note)}</text>'
        )

    b = []
    # 1. The prompt: the question plus the format rule that makes every agent end with {"items": [...]}.
    rows = textwrap.wrap(question, 126)
    fmt_rule, fmt_shape = fmt.split("\n")[:2]
    ph = 34 + 24 + (len(rows) + 2) * lh + 12
    b.append(panel(10, 10, 1200, ph, 1, "the prompt", "sent word for word to both agents · task H1", F))
    y = 10 + 34 + 24
    for i, row in enumerate(rows):
        lead, _, rest = row.partition("executeMarketTransfer")
        hit = [("executeMarketTransfer", LIT, 1)] if rest or row.endswith("executeMarketTransfer") else []
        b.append(line(26, y, [("Question: " if i == 0 else "          ", DIM), (lead, INK)] + hit + [(rest, INK)], fs=14))
        y += lh
    pre, post = fmt_shape.split('{"items"', 1)
    b.append(line(26, y + 4, [(fmt_rule, DIM)], fs=13))
    b.append(line(26, y + 4 + lh, [(pre, DIM), ('{"items"', F, 1), (post + "  …", DIM)], fs=13))

    # 2. The answer key for that same task, written by the compiler.
    y0 = 10 + ph + 10
    kh = 34 + 24 + 5 * lh + 14
    b.append(panel(10, y0, 1200, kh, 2, "answer-keys.json", "the key for H1 · written by the TypeScript compiler, no LLM", HEAD))
    y = y0 + 34 + 24
    b.append(line(26, y, [("{", P)] + k("generatedFrom") + [(f'"{key_file["generatedFrom"]}"', S), (",", P)], fs=13))
    y += lh
    b.append(line(26, y, [(" ", P)] + k("h1", HEAD) + [("[", P)]))
    per = 3
    cols = [keys[i:i + per] for i in range(0, len(keys), per)]
    cx = 50
    for col in cols:
        for row, entry in enumerate(col):
            file, sym = entry.split("#")
            color = RED if entry in grep_run["score"]["missed"] else S
            b.append(line(cx, y + (row + 1) * lh, [(f'"{file}#', color), (sym, RED if color == RED else LIT, 1), ('",', color)], fs=13))
        cx += (max(len(e) for e in col) + 6) * 13 * 0.6
    y += (per + 1) * lh
    b.append(line(26, y, [(" ],", P), (' "h2": […], "h3": […], …  one key per task', DIM), ("}", P)], fs=13))

    # 3. What each agent answered, and the score score.ts gave it.
    y0 += kh + 10
    n_items = max(len(r["answer_items"]) + len(r["score"]["missed"]) for r in (grep_run, graph_run))
    ah = 34 + 22 + 2 * lh + n_items * ilh + 2 * lh + 4
    for x, r, who, color in [(10, grep_run, f"grep agent · Sonnet 5.5 · run {grep_run['repeat']}", GOLD),
                             (615, graph_run, f"graph agent · Sonnet 5.5 · run {graph_run['repeat']}", ACCENT)]:
        b.append(panel(x, y0, 595, ah, 3, "results/agent.json", who, color))
        y = y0 + 34 + 24
        tx = x + 16
        b.append(line(tx, y, [("{", P)] + k("toolCalls") + [(str(r["toolCalls"]), color, 1), (", ", P)]
                      + k("inputTokens") + [(f'{r["inputTokens"]}', color, 1), (",", P)]))
        y += lh
        b.append(line(tx, y, [(" ", P)] + k("answer") + [('"… ```json ', S), ('{"items"', F, 1), (": [", S)]))
        items = r["answer_items"]
        for it in items:
            y += ilh
            b.append(line(tx, y, [("  {", P)] + k("file")[:1] + [(":", P), (f'"{it["file"]}"', S), (",", P)]
                          + k("symbol")[:1] + [(":", P), (f'"{it["symbol"]}"', LIT), ("},", P)], fs=13))
        for m in r["score"]["missed"]:
            y += ilh
            b.append(line(tx, y, [(f"  // ✗ no {m}", RED, 1)], fs=13))
        y = y0 + 34 + 24 + lh + n_items * ilh + lh
        b.append(line(tx, y, [(' ]} ```",', S)]))
        s = r["score"]
        assert len({f"{i['file']}#{i['symbol']}" for i in items} & set(keys)) == s["correct"], "payload disagrees with score.ts"
        y += lh
        b.append(line(tx, y, [(" ", P)] + k("score") + [("{", P)] + k("accuracy") + [(f'{s["accuracy"]:.2f}', color, 1), (", ", P)]
                      + k("recall") + [(f'{s["recall"]:.2f}', N), (", ", P)] + k("precision") + [(f'{s["precision"]:g}', N), (", …}}", P)]))
    return static_svg(1220, y0 + ah + 10, "".join(b))


# Slide "…and where it doesn't": every task as the plain question a developer would type, grouped by whether the map
# pays off. Ratios and accuracy are read from the Sonnet results; the band each task sits in must agree with them.
TASK_BANDS = [
    ("USE THE MAP", "the answer is a chain of calls across files", ACCENT, [
        ("H2", "What breaks if I change contractEndDate?", "callers of callers, 3 hops deep"),
        ("H1", "What can make a rival club sign a player?", "every chain up to the entry points"),
        ("H4", "Which tests should I run for transferProceeds?", "tests that reach it within 3 hops"),
        ("T5", "What does executeMarketTransfer call?", "one function's direct callees"),
        ("H6", "Plan it: add a database migration", "code + tests + docs to touch"),
        ("H7", "Plan it: a levy on release-clause payments", "code + callers + tests + docs"),
    ]),
    ("EITHER WAY", "one search already finds it, or the link is a URL string", MUTED, [
        ("T7", "Where is clamp defined?", "a single grep hits the definition"),
        ("T2", "Trace 'advance day' from the API to the match engine", "starts at a URL route; short chain after"),
        ("T8", "Which screen calls GET /api/clubs/:id/transfers?", "UI and server meet only in a URL"),
    ]),
    ("SKIP THE MAP", "whole-repo audits: a small script is cheaper", RED, [
        ("H5", "Which exported functions does nobody use?", "one script counts them directly"),
        ("H3", "Which files import each other in a loop?", "report shows a sample, agent re-checks"),
    ]),
]


def task_ratios() -> str:
    def mean(rs, key):
        return sum(key(r) for r in rs) / len(rs)

    x_label, x_bar, unit, cap = 640, 660, 220, 1.6
    b = [
        f'<text x="20" y="24" font-size="15" fill="{MUTED}">the question you ask your agent</text>',
        f'<text x="{x_bar}" y="24" font-size="15" fill="{MUTED}">input tokens: map ÷ grep</text>',
        f'<text x="1190" y="24" font-size="15" fill="{MUTED}" text-anchor="end">accuracy map / grep</text>',
    ]
    y = 44
    top = y
    for band, why, color, rows in TASK_BANDS:
        b.append(f'<rect x="10" y="{y}" width="1180" height="30" rx="6" fill="{color}" fill-opacity="0.14"/>')
        b.append(f'<rect x="10" y="{y}" width="6" height="30" rx="3" fill="{color}"/>')
        b.append(f'<text x="28" y="{y + 21}" font-size="16" font-weight="800" fill="{color}">{band}<tspan fill="{INK}" font-weight="400">  ·  {escape(why)}</tspan></text>')
        y += 36
        for task, question, reason in rows:
            a, g = runs(task, "A"), runs(task, "G")
            ratio = mean(g, lambda r: r["inputTokens"]) / mean(a, lambda r: r["inputTokens"])
            acc_g, acc_a = (round(100 * mean(rs, lambda r: r["score"]["accuracy"])) for rs in (g, a))
            expected = "USE THE MAP" if ratio < 0.85 else "SKIP THE MAP" if ratio > 1.2 else "EITHER WAY"
            assert band == expected, f"{task}: ratio {ratio:.2f} does not belong in {band}"
            b.append(f'<text x="{x_label}" y="{y + 18}" font-size="18" fill="{INK}" text-anchor="end">{escape(question)}</text>')
            b.append(f'<text x="{x_label}" y="{y + 37}" font-size="13" fill="{MUTED}" text-anchor="end">{escape(reason)}</text>')
            w = unit * min(ratio, cap)
            b.append(f'<rect x="{x_bar}" y="{y + 6}" width="{w:.0f}" height="24" rx="4" fill="{color}"/>')
            if ratio > cap:
                bx = x_bar + w - 46
                b.append(f'<path d="M{bx} {y + 34} l10 -32 M{bx + 12} {y + 34} l10 -32" stroke="{DECK_BG}" stroke-width="6"/>')
            b.append(f'<text x="{x_bar + w + 8:.0f}" y="{y + 25}" font-size="18" font-weight="800" fill="{color}" stroke="{DECK_BG}" stroke-width="5" paint-order="stroke">{ratio:.2f}×</text>')
            b.append(f'<text x="1190" y="{y + 25}" font-size="17" fill="{MUTED}" text-anchor="end">{acc_g} / {acc_a}</text>')
            y += 44
        y += 4
    one = x_bar + unit
    b.insert(3, f'<line x1="{one}" y1="{top - 6}" x2="{one}" y2="{y}" stroke="{INK}" stroke-dasharray="6 5" stroke-width="2" opacity="0.6"/>')
    b.append(f'<text x="{one}" y="{y + 18}" font-size="14" fill="{INK}" text-anchor="middle">1.0 = same as grep</text>')
    return static_svg(1200, y + 26, "".join(b))


MODEL_TASKS = ["H1", "H2", "H3", "H4", "H5", "H6", "H7"]  # the graph-shaped questions both models ran


def model_costs() -> str:
    """Cost, accuracy and effort per question for Sonnet and Haiku, each with and without the map, on the 7 shared tasks."""
    followup = json.loads((BENCH / "results" / "followup-h4-haiku.json").read_text())["results"]

    def per_task(model, arm, task):
        # Haiku's first H4 graph runs used the wrong recipe; the report uses the follow-up run after the instruction fix.
        if model == "haiku" and arm == "G" and task == "H4":
            return [r for r in followup if r["arm"] == "G"]
        return runs(task, arm, model)

    def stat(model, arm, key):
        return sum(sum(key(r) for r in rs) / len(rs) for rs in (per_task(model, arm, t) for t in MODEL_TASKS)) / len(MODEL_TASKS)

    cols = []
    for model, label, x0 in [("sonnet", "Sonnet 5.5", 300), ("haiku", "Haiku 5.5", 790)]:
        for arm, x in [("A", x0), ("G", x0 + 170)]:
            cols.append({
                "model": model, "label": label, "arm": arm, "x": x,
                "cost": stat(model, arm, lambda r: r["nanoAiu"]),
                "acc": 100 * stat(model, arm, lambda r: r["score"]["accuracy"]),
                "tokens": stat(model, arm, lambda r: r["inputTokens"]),
                "calls": stat(model, arm, lambda r: r["toolCalls"]),
                "secs": stat(model, arm, lambda r: r["wallMs"]) / 1000,
            })
    base = cols[0]["cost"]
    for c in cols:
        c["index"] = 100 * c["cost"] / base
    s_grep, s_map, h_grep, h_map = cols
    assert abs(h_map["acc"] - s_grep["acc"]) < 1, "Haiku + map no longer matches Sonnet's accuracy"

    bw, top, floor = 120, 70, 300
    scale = (floor - top) / 100
    b = [f'<text x="20" y="24" font-size="15" fill="{MUTED}">cost per question · Copilot billing, Sonnet + grep = 100 · 7 graph-shaped questions × 3 runs</text>']
    per_token = (s_grep["cost"] / s_grep["tokens"]) / (h_grep["cost"] / h_grep["tokens"])
    for label, sub, x in [("Sonnet 5.5", "big model", 385), ("Haiku 5.5", f"small model, ~{per_token:.0f}× cheaper per token read", 875)]:
        b.append(f'<text x="{x}" y="{floor + 74}" font-size="19" font-weight="800" fill="{INK}" text-anchor="middle">{label}'
                 f'<tspan font-size="14" font-weight="400" fill="{MUTED}">  {sub}</tspan></text>')
    b.append(f'<line x1="200" y1="{floor}" x2="1190" y2="{floor}" stroke="{LINE}" stroke-width="2"/>')
    b.append(f'<line x1="200" y1="{top}" x2="1190" y2="{top}" stroke="{LINE}" stroke-dasharray="4 6"/>')
    for c in cols:
        color = ACCENT if c["arm"] == "G" else MUTED
        h = max(c["index"] * scale, 3)
        x = c["x"] - bw / 2
        b.append(f'<rect x="{x}" y="{floor - h:.0f}" width="{bw}" height="{h:.0f}" rx="6" fill="{color}"/>')
        b.append(f'<text x="{c["x"]}" y="{floor - h - 10:.0f}" font-size="28" font-weight="800" fill="{INK}" text-anchor="middle">{c["index"]:.0f}</text>')
        b.append(f'<text x="{c["x"]}" y="{floor + 26}" font-size="17" font-weight="700" fill="{color}" text-anchor="middle">{"grep" if c["arm"] == "A" else "+ map"}</text>')
    # Same model, with vs without the map.
    for a, g in [(s_grep, s_map), (h_grep, h_map)]:
        save = 1 - g["cost"] / a["cost"]
        cx = (a["x"] + g["x"]) / 2
        y = floor + 26
        b.append(f'<rect x="{cx - 40}" y="{y - 20}" width="80" height="28" rx="14" fill="{DECK_BG}" stroke="{ACCENT}" stroke-width="2"/>')
        b.append(f'<text x="{cx}" y="{y}" font-size="16" font-weight="800" fill="{ACCENT}" text-anchor="middle">−{100 * save:.0f}%</text>')
    # Big model without the map vs small model with it.
    times = s_grep["cost"] / h_map["cost"]
    b.append(f'<path d="M{s_grep["x"] + 40} {top - 6} C {s_grep["x"] + 400} {top - 50}, {h_map["x"]} {top - 50}, {h_map["x"]} {floor - 70}" '
             f'fill="none" stroke="{GOLD}" stroke-width="3" stroke-dasharray="8 6" marker-end="url(#gold)"/>')
    b.append(f'<text x="{h_map["x"] - 44}" y="{top + 60}" font-size="22" font-weight="800" fill="{GOLD}" text-anchor="end">{times:.0f}× cheaper, same accuracy</text>')
    b.append(f'<text x="{h_map["x"] - 44}" y="{top + 84}" font-size="15" fill="{GOLD}" text-anchor="end">Haiku + map {h_map["acc"]:.1f}%  vs  Sonnet + grep {s_grep["acc"]:.1f}%</text>')
    # Per-question effort under each bar.
    rows = [
        ("accuracy", lambda c: f'{c["acc"]:.1f}%'),
        ("tokens read", lambda c: f'{c["tokens"] / 1000:.0f}k'),
        ("tool calls", lambda c: f'{c["calls"]:.1f}'),
        ("time", lambda c: f'{c["secs"]:.0f} s'),
    ]
    y = floor + 112
    for i, (name, fmt) in enumerate(rows):
        if i % 2 == 0:
            b.append(f'<rect x="10" y="{y - 21}" width="1180" height="30" rx="4" fill="{PANEL}"/>')
        b.append(f'<text x="24" y="{y}" font-size="16" fill="{MUTED}">{name}<tspan font-size="13"> / question</tspan></text>')
        for c in cols:
            b.append(f'<text x="{c["x"]}" y="{y}" font-size="17" font-weight="700" fill="{ACCENT if c["arm"] == "G" else INK}" text-anchor="middle">{fmt(c)}</text>')
        y += 30
    b.insert(0, f'<defs><marker id="gold" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="{GOLD}"/></marker></defs>')
    return static_svg(1200, y - 8, "".join(b))


# Real files and their node counts in the graph at the benchmark commit (6cb5b3f); the label is the community the file
# mostly lands in, named after its biggest files.
BUILD_FILES = [
    ("server/simulation.ts", "149 KB", 42, "simulation.ts"),
    ("server/transfer-battles.ts", "47 KB", 46, "transfer-battles.ts"),
    ("server/app.ts", "68 KB", 27, "systems.ts + app.ts"),
    ("server/db.ts", "40 KB", 68, "db.ts"),
    ("server/finance.ts", "47 KB", 61, "finance.ts"),
    ("shared/types.ts", "23 KB", 45, "api.ts + types.ts"),
    ("shared/rules.ts", "39 KB", 74, "rules.ts"),
    ("shared/world-catalog/caf.ts", "214 KB", 143, "world-catalog"),
    ("src/App.tsx", "29 KB", 36, "App.tsx"),
    ("src/views/Transfers.tsx", "103 KB", 31, "Transfers view"),
    (".github/workflows/ci.yml", "13 KB", 117, "ci.yml"),
]
BUILD_STATS = {"files": 349, "nodes": 5653, "edges": 18046, "communities": 193, "seconds": 14}
BUILD_RELATIONS = [("contains", 5094, DIM), ("imports", 6067, "#79c0ff"), ("calls", 6046, "#4db18f"), ("references", 421, "#d2a8ff")]
PALETTE = ["#3fb950", "#58a6ff", "#d2a8ff", "#f2cc60", "#ff7b72", "#56d4dd", "#ffa657", "#79c0ff", "#e3b341", "#f778ba", "#a5d6ff"]


def graphify_build(frame):
    """Full-slide story of `graphify update .` on a fresh repo: scan, parse, link, cluster, write outputs."""
    SW, SH = 1280, 720
    rng = random.Random(11)
    box = (488, 172, 1232, 520)  # where the graph forms
    t_scan, t_parse, t_link, t_cluster, t_out = 1.0, 3.1, 6.9, 9.5, 11.9
    row_y0, row_dy, row_x = 228, 31, 74
    rows = BUILD_FILES + [("… 338 more files", "", BUILD_STATS["nodes"] - sum(f[2] for f in BUILD_FILES), None)]

    # Nodes: a handful of dots per real file, more for the long tail, each with its cluster.
    clusters, nodes = [], []
    for i, (_, _, count, label) in enumerate(rows):
        if label is None:
            for j in range(9):
                clusters.append({"label": None, "n": rng.randint(4, 7), "row": i, "color": "#6e7681"})
        else:
            clusters.append({"label": label, "n": max(4, round(count / 6)), "row": i, "color": PALETTE[i % len(PALETTE)]})
    for i, c in enumerate(clusters):
        c["r"] = 8.5 * math.sqrt(c["n"]) + 9
        half = max(c["r"], len(c["label"] or "") * 4.1)
        top = 34 if c["row"] == 1 and c["label"] else 0  # room for the executeMarketTransfer() tag
        if c["row"] == 1 and c["label"]:
            half = max(half, 122)
        c["ext"] = (half, c["r"] + top, half, c["r"] + (20 if c["label"] else 0))

    def bbox(c, x, y):
        l, t, r, d = c["ext"]
        return (x - l, y - t, x + r, y + d)

    placed = []
    centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    for c in sorted(clusters, key=lambda c: (c["row"] != 1, c["label"] is None, -c["r"])):
        best = None
        l, t, r, d = c["ext"]
        for gx in range(int(box[0] + l), int(box[2] - r) + 1, 5):
            for gy in range(int(box[1] + t), int(box[3] - d) + 1, 5):
                mine = bbox(c, gx, gy)
                if all(mine[2] + 8 < o[0] or o[2] + 8 < mine[0] or mine[3] + 6 < o[1] or o[3] + 6 < mine[1] for o in placed):
                    dist = math.dist((gx, gy), centre) * (1 if c["label"] else 0.6) + rng.uniform(0, 30)
                    if best is None or dist < best[0]:
                        best = (dist, gx, gy)
        assert best, f"no room for cluster {c['label']}"
        c["x"], c["y"] = best[1], best[2]
        placed.append(bbox(c, c["x"], c["y"]))
    for ci, c in enumerate(clusters):
        for k in range(c["n"]):
            rr, ang = 8.5 * math.sqrt(k + 0.4), k * 2.39996
            ry = row_y0 + c["row"] * row_dy - 5
            nodes.append({
                "c": ci, "k": k,
                "row": (430, ry),
                "scatter": (rng.uniform(box[0] + 10, box[2] - 10), rng.uniform(box[1] + 10, box[3] - 10)),
                "cluster": (c["x"] + rr * math.cos(ang), c["y"] + rr * math.sin(ang)),
                "fly": t_parse + 0.35 + c["row"] * 0.27 + rng.uniform(0, 0.22),
            })
    by_cluster = {}
    for i, n in enumerate(nodes):
        by_cluster.setdefault(n["c"], []).append(i)

    # Edges: mostly inside a cluster, a few across; relation drawn in proportion to the real counts.
    edges = []
    for ci, members in by_cluster.items():
        for i in members:
            others = sorted((j for j in members if j != i), key=lambda j: math.dist(nodes[i]["cluster"], nodes[j]["cluster"]))
            for j in others[: 1 + (nodes[i]["k"] % 2)]:
                if (j, i) not in edges and (i, j) not in edges:
                    edges.append((i, j))
    inter = []
    while len(inter) < 34:
        i, j = rng.randrange(len(nodes)), rng.randrange(len(nodes))
        if nodes[i]["c"] != nodes[j]["c"]:
            inter.append((i, j))
    rel_names = [r[0] for r in BUILD_RELATIONS]
    rel_weights = [r[1] for r in BUILD_RELATIONS]
    edge_rel = [rng.choices(rel_names, rel_weights)[0] for _ in edges] + [rng.choice(["imports", "calls"]) for _ in inter]
    edges += inter
    # The question from the next slides: executeMarketTransfer and its caller decide, inside transfer-battles.
    tb = by_cluster[1]
    emt, dec = tb[0], tb[1]
    if (emt, dec) not in edges and (dec, emt) not in edges:
        edges.append((dec, emt))
        edge_rel.append("calls")

    end = t_out + 2.6
    period = end + HOLD + 1.2
    a = Anim(period, end + 1.0, frame)
    move = (t_cluster + 0.1, t_cluster + 1.4)
    b = []

    # Title and stage bar.
    b.append(f'<text x="64" y="70" font-size="36" font-weight="700" fill="{HEAD}"><tspan fill="{ACCENT}"># </tspan>Behind the scenes: graphify meets a repo</text>')
    stages = [("1 scan files", t_scan), ("2 parse (tree-sitter)", t_parse), ("3 link", t_link), ("4 cluster (Leiden)", t_cluster), ("5 write outputs", t_out)]
    sx = 64
    for i, (label, on) in enumerate(stages):
        off = stages[i + 1][1] if i + 1 < len(stages) else period
        w = len(label) * 9.6 + 34
        b.append(
            f'<rect x="{sx}" y="96" width="{w:.0f}" height="32" rx="16" stroke-width="2">'
            f'{a.animate("fill", [(0, PANEL), (on, PANEL), (on + 0.2, ACCENT), (off, ACCENT), (off + 0.2, PANEL)])}'
            f'{a.animate("stroke", [(0, LINE), (on, LINE), (on + 0.2, ACCENT)])}</rect>'
            f'<text x="{sx + w / 2:.0f}" y="117" font-size="16" font-weight="700" text-anchor="middle">'
            f'{a.animate("fill", [(0, MUTED), (on, MUTED), (on + 0.2, DECK_BG), (off, DECK_BG), (off + 0.2, ACCENT)])}{escape(label)}</text>'
        )
        if i + 1 < len(stages):
            b.append(f'<text x="{sx + w + 9:.0f}" y="117" font-size="16" fill="{LINE}">→</text>')
        sx += w + 30

    # Left: the repo, with the command typed on top.
    b.append(f'<rect x="56" y="150" width="398" height="482" rx="12" fill="{PANEL}" stroke="{LINE}" stroke-width="1.5"/>')
    cmd = "$ graphify update ."
    cid = "buildcmd"
    widths = [(0.3 + i * 0.045, f"{i * 10.2:.1f}") for i in range(len(cmd) + 1)]
    b.append(
        f'<clipPath id="{cid}"><rect x="{row_x}" y="168" height="26" width="0">{a.animate("width", [(0, "0")] + widths, discrete=True)}</rect></clipPath>'
        f'<text x="{row_x}" y="187" font-size="17" clip-path="url(#{cid})"><tspan fill="{ACCENT}">$ </tspan><tspan fill="{INK}">graphify update .</tspan></text>'
    )
    b.append(f'<line x1="70" y1="203" x2="440" y2="203" stroke="{LINE}"/>')
    for i, (name, size, count, _) in enumerate(rows):
        y = row_y0 + i * row_dy
        on = t_scan + i * 0.17
        parsed = t_parse + 0.35 + i * 0.27
        tail = name.startswith("…")
        b.append(
            f'<rect x="64" y="{y - 21}" width="382" height="28" rx="5" fill="{ACCENT}" opacity="0">'
            f'{a.animate("opacity", [(0, "0"), (parsed, "0"), (parsed + 0.05, "0.28"), (parsed + 0.45, "0")])}</rect>'
        )
        b.append(
            f'<g opacity="0">{a.show(on, fade=0.15)}'
            f'<text x="{row_x}" y="{y}" font-size="15" fill="{MUTED if tail else INK}">{escape(name)}</text></g>'
            f'<g opacity="0">{a.show(on, parsed + 0.1, fade=0.15)}'
            f'<text x="436" y="{y}" font-size="13" fill="{MUTED}" text-anchor="end">{escape(size)}</text></g>'
            f'<g opacity="0">{a.show(parsed + 0.2, fade=0.2)}'
            f'<text x="436" y="{y}" font-size="13" font-weight="700" fill="{ACCENT}" text-anchor="end">+{count:,} nodes</text></g>'
        )
    sweep_from, sweep_to = t_parse + 0.3, t_parse + 0.35 + len(rows) * 0.27
    b.append(
        f'<rect x="60" width="390" height="3" fill="{ACCENT}" opacity="0">'
        f'{a.animate("y", [(0, f"{row_y0 - 24}"), (sweep_from, f"{row_y0 - 24}"), (sweep_to, f"{row_y0 + len(rows) * row_dy - 18}")])}'
        f'{a.show(sweep_from, sweep_to + 0.1, fade=0.1)}</rect>'
    )
    b.append(f'<g opacity="0">{a.show(t_scan + 0.2)}<text x="70" y="620" font-size="13" fill="{MUTED}">honours .gitignore + .graphifyignore</text></g>')

    # Edges first (under the nodes): drawn at the scattered positions, then pulled along into their clusters.
    for (i, j), rel in zip(edges, edge_rel):
        n1, n2 = nodes[i], nodes[j]
        same = n1["c"] == n2["c"]
        appear = t_link + 0.15 + rel_names.index(rel) * 0.55 + rng.uniform(0, 0.3)
        rel_color = dict((r[0], r[2]) for r in BUILD_RELATIONS)[rel]
        final_color = clusters[n1["c"]]["color"] if same else LINE
        parts = []
        for attr, idx, n in [("x1", 0, n1), ("y1", 1, n1), ("x2", 0, n2), ("y2", 1, n2)]:
            s, c = f'{n["scatter"][idx]:.1f}', f'{n["cluster"][idx]:.1f}'
            parts.append(a.animate(attr, [(0, s), (move[0], s), (move[1], c)]))
        parts.append(a.animate("stroke", [(0, rel_color), (move[0], rel_color), (move[1], final_color)]))
        level = "0.55" if same else "0.3"
        parts.append(a.show(appear, fade=0.3, level=level))
        b.append(f'<line stroke-width="1.4" opacity="0">{"".join(parts)}</line>')

    # Nodes: fly out of their file row, scatter, then settle into their community.
    for n in nodes:
        (rx, ry), (sx_, sy_), (cx, cy) = n["row"], n["scatter"], n["cluster"]
        f0, f1 = n["fly"], n["fly"] + 0.55
        color = clusters[n["c"]]["color"]
        b.append(
            f'<circle r="4.2" opacity="0">'
            f'{a.animate("cx", [(0, f"{rx}"), (f0, f"{rx}"), (f1, f"{sx_:.1f}"), (move[0], f"{sx_:.1f}"), (move[1], f"{cx:.1f}")])}'
            f'{a.animate("cy", [(0, f"{ry}"), (f0, f"{ry}"), (f1, f"{sy_:.1f}"), (move[0], f"{sy_:.1f}"), (move[1], f"{cy:.1f}")])}'
            f'{a.animate("fill", [(0, "#c9d1d9"), (move[0], "#c9d1d9"), (move[1], color)])}'
            f"{a.show(f0, fade=0.1)}</circle>"
        )

    # Community halos and names.
    for c in clusters:
        b.append(
            f'<g opacity="0">{a.show(move[1] - 0.1, fade=0.4)}'
            f'<circle cx="{c["x"]:.1f}" cy="{c["y"]:.1f}" r="{c["r"]:.1f}" fill="{c["color"]}" fill-opacity="0.07" stroke="{c["color"]}" stroke-opacity="0.35" stroke-dasharray="3 4"/>'
            + (f'<text x="{c["x"]:.1f}" y="{c["y"] + c["r"] + 16:.1f}" font-size="13" font-weight="700" fill="{c["color"]}" text-anchor="middle">{escape(c["label"])}</text>' if c["label"] else "")
            + "</g>"
        )

    # Spotlight: the function the rest of the talk asks about.
    ex, ey = nodes[emt]["cluster"]
    dx, dy = nodes[dec]["cluster"]
    spot = move[1] + 0.9
    tbc = clusters[nodes[emt]["c"]]
    tcx, tty = tbc["x"], tbc["y"] - tbc["r"] - 32
    b.append(
        f'<g opacity="0">{a.show(spot, fade=0.3)}'
        f'<line x1="{dx:.1f}" y1="{dy:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="{LIT}" stroke-width="2.5"/>'
        f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="22" fill="url(#glow)"/><circle cx="{ex:.1f}" cy="{ey:.1f}" r="6" fill="{LIT}"/>'
        f'<circle cx="{dx:.1f}" cy="{dy:.1f}" r="5" fill="{LIT}"/>'
        f'<line x1="{ex:.1f}" y1="{ey:.1f}" x2="{tcx:.1f}" y2="{tty + 24:.1f}" stroke="{LIT}" stroke-dasharray="2 3"/>'
        f'<rect x="{tcx - 118:.1f}" y="{tty:.1f}" width="236" height="24" rx="6" fill="{DECK_BG}" stroke="{LIT}"/>'
        f'<text x="{tcx:.1f}" y="{tty + 17:.1f}" font-size="14" font-weight="700" fill="{LIT}" text-anchor="middle">executeMarketTransfer()</text></g>'
    )

    # Parse inset: what tree-sitter turns one real call into.
    ix, iy, iw = 600, 166, 620
    code = [
        [("476 ", MUTED), ("export async function ", "#ff7b72"), ("executeMarketTransfer", "#d2a8ff"), ("(store, player, …) {", INK)],
        [("882 ", MUTED), ("async function ", "#ff7b72"), ("decide", "#d2a8ff"), ("(context: BattleContext) {", INK)],
        [("927 ", MUTED), ("  await ", "#ff7b72"), ("executeMarketTransfer", "#d2a8ff"), ("(store, allowed.player, …)", INK)],
    ]
    out_lines = [
        [("node ", MUTED), ('{"label": "', MUTED), ("executeMarketTransfer()", LIT), ('", "source_location": "L476"}', MUTED)],
        [("node ", MUTED), ('{"label": "', MUTED), ("decide()", LIT), ('", "source_location": "L882"}', MUTED)],
        [("edge ", MUTED), ("decide()", LIT), (" --calls--> ", "#4db18f"), ("executeMarketTransfer()", LIT), ("  EXTRACTED", GOLD)],
    ]
    i_on, i_off = t_parse + 0.25, t_link - 0.25
    b.append(
        f'<g opacity="0">{a.show(i_on, i_off, fade=0.3)}'
        f'<rect x="{ix}" y="{iy}" width="{iw}" height="268" rx="12" fill="{DECK_BG}" fill-opacity="0.96" stroke="{HEAD}" stroke-width="2"/>'
        f'<text x="{ix + 18}" y="{iy + 28}" font-size="15" font-weight="700" fill="{INK}">server/transfer-battles.ts</text>'
        f'<text x="{ix + iw - 18}" y="{iy + 28}" font-size="14" fill="{HEAD}" text-anchor="end">tree-sitter AST, no LLM</text>'
        f'<line x1="{ix}" y1="{iy + 40}" x2="{ix + iw}" y2="{iy + 40}" stroke="{LINE}"/>'
    )
    for k, spans in enumerate(code):
        b.append(f'<text x="{ix + 18}" y="{iy + 68 + k * 24}" font-size="14">{spans_svg(spans)}</text>')
    b.append(f'<text x="{ix + iw / 2}" y="{iy + 148}" font-size="20" fill="{ACCENT}" text-anchor="middle">↓</text>')
    for k, spans in enumerate(out_lines):
        b.append(
            f'<g opacity="0">{a.show(i_on + 0.9 + k * 0.5, i_off, fade=0.2)}'
            f'<text x="{ix + 18}" y="{iy + 182 + k * 26}" font-size="13.5">{spans_svg(spans)}</text></g>'
        )
    b.append("</g>")

    # Link legend, with the real edge counts per relation.
    lx = box[0]
    b.append(f'<g opacity="0">{a.show(t_link + 0.1, t_out - 0.1, fade=0.2)}')
    for k, (rel, count, color) in enumerate(BUILD_RELATIONS):
        on = t_link + 0.15 + k * 0.55
        w = len(f"{rel} {count:,}") * 8.4 + 40
        b.append(
            f'<g opacity="0">{a.show(on, t_out - 0.1, fade=0.2)}'
            f'<line x1="{lx}" y1="{548}" x2="{lx + 22}" y2="{548}" stroke="{color}" stroke-width="3"/>'
            f'<text x="{lx + 30}" y="553" font-size="14" fill="{INK}">{rel} <tspan fill="{MUTED}">{count:,}</tspan></text></g>'
        )
        lx += w + 14
    b.append("</g>")

    # Outputs.
    outs = [
        ("graph.json", "every node + edge", "for the agent"),
        ("GRAPH_REPORT.md", "hubs · cycles · communities", "the summary"),
        ("graph.html", "the interactive map", "for humans"),
    ]
    ow, ogap = 240, 12
    for k, (name, what, why) in enumerate(outs):
        ox = box[0] + k * (ow + ogap)
        on = t_out + 0.25 + k * 0.45
        b.append(
            f'<g opacity="0">{a.show(on, fade=0.3)}'
            f'<rect x="{ox}" y="534" width="{ow}" height="84" rx="10" fill="{PANEL}" stroke="{ACCENT}" stroke-width="2"/>'
            f'<text x="{ox + 14}" y="558" font-size="13" fill="{MUTED}">graphify-out/</text>'
            f'<text x="{ox + ow - 14}" y="558" font-size="13" fill="{GOLD}" text-anchor="end">{escape(why)}</text>'
            f'<text x="{ox + 14}" y="583" font-size="18" font-weight="700" fill="{ACCENT}">{escape(name)}</text>'
            f'<text x="{ox + 14}" y="606" font-size="13" fill="{INK}">{escape(what)}</text></g>'
        )
    b.append(
        f'<g opacity="0">{a.show(t_out + 1.9, fade=0.3)}'
        f'<text x="{box[0]}" y="646" font-size="15" fill="{GOLD}">↻ pre-commit hook: re-runs on every commit, only changed files (SHA256 cache)</text></g>'
    )

    # Stat strip: counts up as each stage lands. "LLM tokens: 0" is there from the start.
    def ticker(x, steps, color, size=26):
        out = []
        for k, (t, value) in enumerate(steps):
            nxt = steps[k + 1][0] if k + 1 < len(steps) else None
            last = nxt if nxt is not None else period - 0.35
            vis = [(0, "0"), (t, "1"), (last, "0")] if t > 0 else [(0, "1"), (last, "0")]
            out.append(f'<text x="{x}" y="690" font-size="{size}" font-weight="800" fill="{color}" text-anchor="middle" opacity="0">'
                       f'{a.animate("opacity", vis, discrete=True)}{escape(value)}</text>')
        return "".join(out)

    s = BUILD_STATS
    stats = [
        ("files", [(0, "0")] + [(t_scan + k * 0.17 * len(rows) / 5, f"{round(s['files'] * k / 5)}") for k in range(1, 6)], INK),
        ("nodes", [(0, "0")] + [(t_parse + 0.35 + k * 0.27 * len(rows) / 6 + 0.4, f"{round(s['nodes'] * k / 6):,}") for k in range(1, 7)], INK),
        ("edges", [(0, "0")] + [(t_link + 0.5 + k * 0.55, f"{sum(r[1] for r in BUILD_RELATIONS[: k + 1]):,}") for k in range(3)] + [(t_link + 0.5 + 3 * 0.55, f"{s['edges']:,}")], INK),
        ("communities", [(0, "–"), (move[1], f"{s['communities']}")], INK),
        ("build time", [(0, "–"), (t_out + 0.25, f"{s['seconds']} s")], ACCENT),
        ("LLM tokens", [(0, "0")], GOLD),
    ]
    cw = (SW - 112) / len(stats)
    b.append(f'<rect x="56" y="656" width="{SW - 112}" height="58" rx="10" fill="{PANEL}" stroke="{LINE}"/>')
    for k, (label, steps, color) in enumerate(stats):
        x = 56 + cw * (k + 0.5)
        b.append(ticker(x, steps, color))
        b.append(f'<text x="{x:.0f}" y="707" font-size="12" fill="{MUTED}" text-anchor="middle">{label}</text>')

    pause = ""
    if frame is not None:
        pause = (
            "<script>document.documentElement.pauseAnimations();"
            f"document.documentElement.setCurrentTime({(frame - a.freeze) % a.period:.3f});</script>"
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SW} {SH}" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, DejaVu Sans Mono, monospace">'
        f'<defs><radialGradient id="glow"><stop offset="0" stop-color="{LIT}" stop-opacity="0.5"/><stop offset="1" stop-color="{LIT}" stop-opacity="0"/></radialGradient></defs>'
        f'<rect width="{SW}" height="{SH}" fill="{DECK_BG}"/><rect width="6" height="{SH}" fill="{ACCENT}"/>'
        f'{"".join(b)}{pause}</svg>\n'
    )


SKILL_DIR = BENCH.parent.parent / ".github" / "skills" / "graphify"
TEAL, CORAL = "#56d4dd", "#ff7b72"
# Passages of the installed SKILL.md that tell the agent when and how to use the graph: (label, gloss, colour, line, ref, quote lines).
SKILL_EXCERPTS = [
    ("WHEN", "the trigger the agent matches", ACCENT, 3, "L3 · description", [
        [("Use for ", INK), ("any question about a codebase", ACCENT), (", its architecture,", INK)],
        [("file relationships, or project content — especially when", INK)],
        [("graphify-out/", ACCENT), (" exists … treated as a ", INK), ("graphify query first", ACCENT), (".", INK)],
    ]),
    ("FAST PATH", "a graph exists? ask it", HEAD, 58, "L58", [
        [("Before doing anything else, check whether ", INK), ("graph.json", HEAD)],
        [("exists … AND the request is a question (\"What calls Y?\"):", INK)],
        [("skip Steps 1–5", HEAD), (" … Run ", INK), ('graphify query "<question>"', HEAD), (" now.", INK)],
    ]),
    ("HOW", "three ways to ask", VIOLET, 39, "L39–43 → references/query.md", [
        [('graphify query "<question>"     ', INK), ("# BFS - broad context", MUTED)],
        [('graphify query "<question>" --dfs ', INK), ("# trace a path", MUTED)],
        [('graphify path "A" "B" · explain "X" ', INK), ("# route · one node", MUTED)],
    ]),
    ("WHEN NOT", "one quick lookup? grep wins", GOLD, 52, "L52", [
        [("If a graph already exists, query it. With no graph, one", INK)],
        [("targeted lookup (\"where is X defined\", \"what calls Y\") is", INK)],
        [("faster and free with a plain text search such as ", INK), ("grep", GOLD)],
    ]),
    ("ANSWER", "cite the graph, never guess", CORAL, 785, "L785 · L803", [
        [("Answer using only what the graph output contains, and", INK)],
        [("quote ", INK), ("source_location", CORAL), (" when citing a specific fact.", INK)],
        [("Never invent an edge. If unsure, use ", INK), ("AMBIGUOUS", CORAL), (".", INK)],
    ]),
]


def graphify_install(frame):
    """Full-slide story of installing Graphify for Copilot: the CLI and MCP server, the skill, and what SKILL.md teaches."""
    SW, SH = 1280, 720
    # Paced for narration: several seconds per stage, then a long hold on the finished frame.
    t_tools, t_skill, t_read, t_ready = 0.8, 8.0, 19.0, 37.5
    end = t_ready + 3.5
    period = end + 40 + 1.2
    a = Anim(period, end + 1.0, frame)
    b = []

    def fade(on, body, off=None, f=0.3):
        return f'<g opacity="0">{a.show(on, off, fade=f)}{body}</g>'

    def tag(x, y, label, color):
        w = len(label) * 8.4 + 22
        return (f'<rect x="{x}" y="{y - 17}" width="{w:.0f}" height="24" rx="12" fill="{color}"/>'
                f'<text x="{x + w / 2:.0f}" y="{y}" font-size="14" font-weight="800" fill="{DECK_BG}" text-anchor="middle">{escape(label)}</text>')

    def box(x, y, w, h, color, fill=PANEL, dash=""):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{color}" stroke-width="2"{d}/>'

    def arrow(x1, y1, x2, y2, color):
        return f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{color}" stroke-width="2" fill="none" marker-end="url(#h{color[1:]})"/>'

    # Title and stage bar.
    b.append(f'<text x="64" y="70" font-size="36" font-weight="700" fill="{HEAD}"><tspan fill="{ACCENT}"># </tspan>Installing Graphify: what the agent gets</text>')
    stages = [("1 install the tools", t_tools), ("2 add the skill", t_skill), ("3 read SKILL.md", t_read), ("4 agent ready", t_ready)]
    sx = 64
    for i, (label, on) in enumerate(stages):
        off = stages[i + 1][1] if i + 1 < len(stages) else period
        w = len(label) * 9.6 + 34
        b.append(
            f'<rect x="{sx}" y="96" width="{w:.0f}" height="32" rx="16" stroke-width="2">'
            f'{a.animate("fill", [(0, PANEL), (on, PANEL), (on + 0.2, ACCENT), (off, ACCENT), (off + 0.2, PANEL)])}'
            f'{a.animate("stroke", [(0, LINE), (on, LINE), (on + 0.2, ACCENT)])}</rect>'
            f'<text x="{sx + w / 2:.0f}" y="117" font-size="16" font-weight="700" text-anchor="middle">'
            f'{a.animate("fill", [(0, MUTED), (on, MUTED), (on + 0.2, DECK_BG), (off, DECK_BG), (off + 0.2, ACCENT)])}{escape(label)}</text>'
        )
        if i + 1 < len(stages):
            b.append(f'<text x="{sx + w + 9:.0f}" y="117" font-size="16" fill="{LINE}">→</text>')
        sx += w + 30

    # Left: the terminal, following the docs (output captured from graphify 0.9.105).
    px0, py0, pw, ph = 56, 146, 560, 440
    b.append(box(px0, py0, pw, ph, LINE, fill="#0f141b")
             + f'<path d="M{px0} {py0 + 30} H{px0 + pw}" stroke="{LINE}"/>'
             + "".join(f'<circle cx="{px0 + 18 + k * 18}" cy="{py0 + 15}" r="5" fill="{c}"/>' for k, c in enumerate(("#ff5f56", "#ffbd2e", "#27c93f")))
             + f'<text x="{px0 + pw / 2:.0f}" y="{py0 + 20}" font-size="13" fill="{MUTED}" text-anchor="middle">bash — ~</text>')
    b.append(fade(0.2, tag(px0 + pw - 92, py0 + 21, "▶ START", ACCENT), f=0.2))
    tx, ty, tl = px0 + 16, py0 + 54, 20.5

    def row(i):
        return ty + i * tl

    def out(i, on, spans):
        b.append(fade(on, text(tx, row(i), spans), f=0.15))

    def cmd(i, on, c):
        b.append(fade(on - 0.4, text(tx, row(i), [("$", ACCENT)]), f=0.1))
        svg, done = typed(a, tx + 2 * CW, row(i), command(c), on, cps=16)
        b.append(svg)
        return done

    done = cmd(0, t_tools + 0.3, 'uv tool install "graphifyy[mcp]"')
    out(1, done + 0.5, [("Resolved 59 packages in 12ms", MUTED)])
    out(2, done + 0.8, [("Installed 59 packages in 41ms", MUTED)])
    t_bins = done + 1.3
    out(3, t_bins, [("Installed 2 executables: ", INK), ("graphify", HEAD), (", ", INK), ("graphify-mcp", TEAL)])

    done = cmd(5, t_skill + 0.3, "graphify copilot install")
    t_written = done + 0.9
    out(6, done + 0.5, [("  references       ->  ~/.copilot/skills/graphify/references", INK)])
    out(7, t_written, [("  skill installed  ->  ", INK), ("~/.copilot/skills/graphify/SKILL.md", ACCENT)])
    out(8, t_written + 0.5, [("Done. Open your AI coding assistant and type: ", MUTED), ("/graphify .", INK)])

    done = cmd(10, t_written + 1.6, "tree ~/.copilot/skills/graphify")
    kb = lambda *names: f'{round(sum((SKILL_DIR / n).stat().st_size for n in names) / 1000)} KB'
    refs = sorted((SKILL_DIR / "references").glob("*.md"), key=lambda p: -p.stat().st_size)
    shown, rest = refs[:4], refs[4:]
    def leaf(prefix, name, color, size="", note=""):
        pad = " " * (31 - len(prefix) - len(name) - len(size))
        return [(prefix, MUTED), (name, color), (pad + size, MUTED)] + ([("  " + note, GOLD)] if note else [])

    tree = [
        (leaf("├── ", "SKILL.md", ACCENT, kb("SKILL.md"), "◀ read when triggered"), "SKILL.md"),
        (leaf("├── ", ".graphify_version", INK, (SKILL_DIR / ".graphify_version").read_text().strip()), None),
        (leaf("└── ", "references/", VIOLET, "", "◀ read on demand"), None),
    ] + [(leaf("    ├── ", p.name, INK, kb("references/" + p.name)), p.name) for p in shown] + [
        (leaf("    └── ", f"{len(rest)} more", INK, kb(*("references/" + p.name for p in rest))), None)
    ]
    tree_rows = {}
    for k, (spans, key) in enumerate(tree):
        on = done + 0.4 + k * 0.25
        out(11 + k, on, spans)
        if key:
            tree_rows[key] = 11 + k

    def glow(key, on, color):
        y = row(tree_rows[key]) - FS
        return fade(on, f'<rect x="{tx - 6}" y="{y - 2:.1f}" width="{pw - 20}" height="{tl:.1f}" rx="4" fill="{color}" fill-opacity="0.16" stroke="{color}" stroke-opacity="0.6"/>', f=0.3)

    # Right: SKILL.md lands, then the passages that steer the agent light up one by one.
    rx, ry, rw, rh = 640, 146, 584, 440
    lines = (SKILL_DIR / "SKILL.md").read_text().splitlines()
    b.append(fade(t_written, box(rx, ry, rw, rh, ACCENT, fill="#0f141b")
                  + f'<path d="M{rx} {ry + 30} H{rx + rw}" stroke="{LINE}"/>'
                  + f'<text x="{rx + 16}" y="{ry + 20}" font-size="14" font-weight="800" fill="{ACCENT}">SKILL.md</text>'
                  + f'<text x="{rx + rw - 16}" y="{ry + 20}" font-size="12.5" fill="{MUTED}" text-anchor="end">{len(lines)} lines · {kb("SKILL.md")} · instructions for the agent</text>'))
    # Minimap of the real file: one bar per 6 lines, width by line length; it fills in as the file is written.
    mx, my, mh = rx + rw - 30, ry + 40, rh - 52
    step = 3
    per = len(lines) / (mh / step)
    bars = []
    for k in range(int(mh / step)):
        chunk = lines[int(k * per):int((k + 1) * per)] or [""]
        w = min(18, sum(len(s) for s in chunk) / len(chunk) / 9)
        if w > 0.5:
            bars.append(f'<rect x="{mx}" y="{my + k * step}" width="{w:.1f}" height="2" fill="{LINE}"/>')
    b.append(f'<clipPath id="mini"><rect x="{mx}" y="{my}" width="20" height="0">'
             f'{a.animate("height", [(0, "0"), (t_written, "0"), (t_written + 1.4, str(mh))])}</rect></clipPath>')
    b.append(fade(t_written, f'<g clip-path="url(#mini)">{"".join(bars)}</g>', f=0.1))

    def line_y(n):
        return my + (n - 1) / len(lines) * mh

    b.append(fade(t_written + 0.6,
                  f'<text x="{rx + 290}" y="{ry + 200}" font-size="15" fill="{MUTED}" text-anchor="middle">{len(lines)} lines the agent reads</text>'
                  f'<text x="{rx + 290}" y="{ry + 224}" font-size="15" fill="{MUTED}" text-anchor="middle">when a question matches …</text>',
                  off=t_read, f=0.4))

    ex, ew, ey, eh = rx + 14, rw - 58, ry + 40, 78
    gap = (rh - 44 - eh * len(SKILL_EXCERPTS)) / (len(SKILL_EXCERPTS) - 1)
    reveal = [t_read + 0.6 + k * 3.5 for k in range(len(SKILL_EXCERPTS))]
    for k, (label, gloss, color, n, ref, quote) in enumerate(SKILL_EXCERPTS):
        y, on = ey + k * (eh + gap), reveal[k]
        body = (f'<rect x="{ex}" y="{y:.1f}" width="{ew}" height="{eh}" rx="8" fill="{PANEL}" stroke="{color}" stroke-opacity="0.55"/>'
                f'<rect x="{ex}" y="{y:.1f}" width="5" height="{eh}" rx="2" fill="{color}"/>'
                f'<text x="{ex + 16}" y="{y + 19:.1f}" font-size="13.5" font-weight="800" fill="{color}">{escape(label)}'
                f'<tspan fill="{INK}" font-weight="700">  {escape(gloss)}</tspan></text>'
                f'<text x="{ex + ew - 12}" y="{y + 19:.1f}" font-size="12" fill="{MUTED}" text-anchor="end">{escape(ref)}</text>')
        for r, spans in enumerate(quote):
            body += f'<text x="{ex + 16}" y="{y + 38 + r * 16.5:.1f}" font-size="12.5">{spans_svg(spans)}</text>'
        b.append(fade(on, body, f=0.4))
        # Where the passage sits in the file: a tick on the minimap, joined to its card.
        ly = line_y(n)
        b.append(fade(on, f'<rect x="{mx - 4}" y="{ly - 2:.1f}" width="26" height="5" rx="2" fill="{color}"/>'
                      f'<path d="M{ex + ew} {y + eh / 2:.1f} C{mx - 8} {y + eh / 2:.1f} {ex + ew + 4} {ly + 0.5:.1f} {mx - 4} {ly + 0.5:.1f}" stroke="{color}" stroke-opacity="0.6" fill="none"/>', f=0.3))
    # The viewport glides down the minimap to each passage as it is read.
    tops = [f"{line_y(ex_[3]) - 14:.1f}" for ex_ in SKILL_EXCERPTS]
    vp = [(0, tops[0])]
    for k, top in enumerate(tops[1:], 1):
        vp += [(reveal[k] - 0.5, tops[k - 1]), (reveal[k], top)]
    b.append(f'<rect x="{mx - 6}" width="30" height="30" rx="4" fill="{INK}" fill-opacity="0.06" stroke="{INK}" stroke-opacity="0.5" opacity="0">'
             f'{a.animate("y", vp)}{a.show(reveal[0] - 0.4, t_ready, fade=0.3)}</rect>')
    # The skill itself is read when a question matches; query.md only when the HOW passage sends the agent there.
    b.append(glow("SKILL.md", t_read, ACCENT))
    b.append(glow("query.md", reveal[2] + 0.4, VIOLET))

    # Bottom: what the agent now has, and what it all points at.
    by, bh = 604, 96
    tools_on = t_bins + 0.4
    cols = [
        (56, 264, ACCENT, t_written + 0.3, [("/graphify", ACCENT, 15, 800), (" skill", MUTED, 13, 400)],
         [("SKILL.md + references/", INK), ("tells the agent WHEN", INK), ("and HOW to use the tools", INK)]),
        (372, 272, HEAD, tools_on, [("graphify", HEAD, 15, 800), (" CLI", MUTED, 13, 400)],
         [("query · path · explain", INK), ("affected · update (build)", INK), ("local · 0 LLM tokens", MUTED)]),
        (660, 272, TEAL, tools_on + 0.4, [("graphify-mcp", TEAL, 15, 800), (" MCP server", MUTED, 13, 400)],
         [("same graph, as MCP tools:", INK), ("query_graph · get_neighbors", INK), ("shortest_path · god_nodes …", INK)]),
        (980, 244, GOLD, t_ready + 0.8, [("graphify-out/", GOLD, 15, 800)],
         [("graph.json", INK), ("one map, both tools read it", INK), ("built next →", MUTED)]),
    ]
    for x, w, color, on, head, rows in cols:
        title = "".join(f'<tspan fill="{c}" font-size="{s}" font-weight="{fw}">{escape(t)}</tspan>' for t, c, s, fw in head)
        body = box(x, by, w, bh, color) + f'<text x="{x + 14}" y="{by + 24}">{title}</text>'
        body += "".join(f'<text x="{x + 14}" y="{by + 47 + r * 19}" font-size="13" fill="{c}">{escape(t)}</text>' for r, (t, c) in enumerate(rows))
        b.append(fade(on, body, f=0.4))
    b.append(fade(tools_on + 0.4, f'<text x="652" y="{by + bh / 2 + 5}" font-size="13" fill="{MUTED}" text-anchor="middle">or</text>'))
    b.append(fade(t_ready, box(364, by - 6, 576, bh + 12, MUTED, fill="none", dash="5 5")
                  + arrow(320, by + bh / 2, 360, by + bh / 2, ACCENT)
                  + f'<text x="340" y="{by - 10}" font-size="12" fill="{ACCENT}" text-anchor="middle">calls</text>'
                  + arrow(940, by + bh / 2, 976, by + bh / 2, GOLD)
                  + f'<text x="958" y="{by - 10}" font-size="12" fill="{GOLD}" text-anchor="middle">read</text>'))
    b.append(fade(end - 1.0, tag(1144, by + 2, "■ END", GOLD), f=0.3))

    heads = "".join(
        f'<marker id="h{c[1:]}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="{c}"/></marker>'
        for c in (ACCENT, GOLD)
    )
    pause = ""
    if frame is not None:
        pause = (
            "<script>document.documentElement.pauseAnimations();"
            f"document.documentElement.setCurrentTime({(frame - a.freeze) % a.period:.3f});</script>"
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SW} {SH}" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, DejaVu Sans Mono, monospace">'
        f'<defs>{heads}</defs><rect width="{SW}" height="{SH}" fill="{DECK_BG}"/><rect width="6" height="{SH}" fill="{ACCENT}"/>'
        f'{"".join(b)}{pause}</svg>\n'
    )


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
        for name, build in [("ground-truth", ground_truth), ("score-example", score_example), ("payloads", payloads), ("task-ratios", task_ratios), ("model-costs", model_costs)]:
            (here / "assets" / f"{name}.svg").write_text(build())
            print(here / "assets" / f"{name}.svg")
    for name, build in [("graphify-demo", graphify_demo), ("grep-relay", grep_relay), ("graphify-build", graphify_build), ("graphify-install", graphify_install), ("harness", harness_run)]:
        out = here / "assets" / f"{name}.svg" if frame is None else Path(f"/tmp/grev/{name}-{frame:g}.svg")
        svg = build(frame)
        out.write_text(svg)
        print(out)
        if frame is None:
            # The PDF and static viewers show the final frame; the HTML deck swaps in this copy, which starts at frame 0.
            live, n = re.subn(r'begin="-[0-9.]+s"', 'begin="0s"', svg)
            assert n, f"{name}: no animations to rewind"
            (here / "assets" / f"{name}.live.svg").write_text(live)
            print(here / "assets" / f"{name}.live.svg")
