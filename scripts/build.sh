#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if (( $# > 1 )); then
  printf 'Usage: scripts/build.sh [image:tag]\n' >&2
  exit 2
fi
command -v docker >/dev/null || { printf 'Docker is required.\n' >&2; exit 1; }
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is unavailable or inaccessible; no image was built.\n' >&2
  exit 1
fi

image="${1:-${TOUCHLINE_IMAGE:-}}"
if [[ -z "$image" && -f .env ]]; then
  image="$(node --env-file=.env --print 'process.env.TOUCHLINE_IMAGE || "touchline:local"')"
fi
image="${image:-touchline:local}"
temporary_config="$(mktemp -d)"
trap 'rm -rf -- "$temporary_config"' EXIT
DOCKER_CONFIG_PATH="$temporary_config" node -e 'require("node:fs").writeFileSync(require("node:path").join(process.env.DOCKER_CONFIG_PATH,"config.json"),JSON.stringify({}),{mode:0o600});'
DOCKER_CONFIG="$temporary_config" docker build --progress=plain --file Dockerfile --tag "$image" .
printf 'Built %s for this machine'"'"'s architecture; nothing was pushed or deployed.\n' "$image"