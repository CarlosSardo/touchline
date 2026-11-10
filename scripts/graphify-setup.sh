#!/usr/bin/env bash
# One-time, per-clone Graphify setup: shared git hooks and the graph.json merge driver.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if ! command -v graphify >/dev/null 2>&1; then
	echo "graphify CLI not found. Install it first: uv tool install graphifyy (or: pipx install graphifyy)" >&2
	exit 1
fi

# Point the merge driver at graphify's own Python so merges also work where graphify is not on PATH.
py="$(sed -n '1s/^#!//p' "$(command -v graphify)")"
git config core.hooksPath .githooks
git config merge.graphify.name "graphify graph.json union merge"
git config merge.graphify.driver "\"${py}\" -m graphify merge-driver %O %A %B"

PYTHONHASHSEED=0 graphify update .
# `update` leaves GRAPH_REPORT.md unwritten when the committed graph is already current (fresh clone), but agents
# start from it. cluster-only writes it; keep the committed graph.json, whose community labels it would rewrite.
if [ ! -f graphify-out/GRAPH_REPORT.md ]; then
	cp graphify-out/graph.json graphify-out/graph.json.keep
	PYTHONHASHSEED=0 graphify cluster-only . >/dev/null
	mv graphify-out/graph.json.keep graphify-out/graph.json
fi
echo "Graphify ready: $(graphify --version). Hooks: .githooks; graph: graphify-out/graph.json"
