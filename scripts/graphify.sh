#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
state="$root/.graphify-tools"
project="$root/tools/graphify"
bin="$project/.venv/bin/graphify"
command="${1:-help}"
if (( $# )); then shift; fi

case "$command" in
  setup)
    if (( $# )); then echo "setup takes no arguments" >&2; exit 2; fi
    mkdir -p "$state"
    UV_NO_CONFIG=1 UV_CACHE_DIR="$state/uv-cache" UV_PYTHON_DOWNLOADS=never \
      uv sync --project "$project" --locked --no-dev --python 3.12
    exit
    ;;
  build)
    if (( $# )); then echo "build takes no arguments" >&2; exit 2; fi
    set -- extract "$root" --code-only --max-workers 2 \
      --exclude .graphify-tools --exclude tools/graphify \
      --exclude benchmarks --exclude docs --timing
    ;;
  query|path|explain|affected)
    set -- "$command" "$@"
    ;;
  version)
    if (( $# )); then echo "version takes no arguments" >&2; exit 2; fi
    set -- --version
    ;;
  *)
    echo "Usage: bash scripts/graphify.sh {setup|build|version|query QUESTION|explain SYMBOL|path FROM TO|affected FILE}" >&2
    exit 2
    ;;
esac

if [[ ! -x "$bin" ]]; then
  echo "Graphify is not installed here. Run: bash scripts/graphify.sh setup" >&2
  exit 1
fi

mkdir -p "$state/home" "$state/cache"
# Do not inherit provider credentials, global Graphify settings or query logs.
exec env -i HOME="$state/home" XDG_CACHE_HOME="$state/cache" \
  PATH="$project/.venv/bin:/usr/bin:/bin" LANG=C.UTF-8 \
  GRAPHIFY_BACKEND=none GRAPHIFY_QUERY_LOG_DISABLE=1 GRAPHIFY_NO_TIPS=1 \
  PYTHONHASHSEED=0 "$bin" "$@"
