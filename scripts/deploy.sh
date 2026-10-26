#!/usr/bin/env bash
# Deploy a commit to a Docker host that already runs PostgreSQL and a reverse proxy, see
# deploy/host-deploy.sh and README ("Deploying from a checkout"). Only committed code is deployed.
# The commit goes over SSH as a tarball (host-deploy.sh and the compose file come from it). By default
# the host pulls the image CI published for it, ghcr.io/carlossardo/touchline:sha-<commit> (image.yml,
# commits on main), with its own `docker login ghcr.io`; with --build the host builds it from the source.
# Usage: scripts/deploy.sh [--build] <ssh-host> [git-ref]    e.g. scripts/deploy.sh carlos@raspberrypi
#   TOUCHLINE_DIR: deploy directory on the host, relative to the SSH user's home (default: touchline)
set -euo pipefail
cd "$(dirname "$0")/.."

usage='Usage: scripts/deploy.sh [--build] <ssh-host> [git-ref]'
build=
[ "${1:-}" != --build ] || { build=1; shift; }
host=${1:?$usage}
ref=${2:-HEAD}
dir=${TOUCHLINE_DIR:-touchline}
[[ $dir =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "TOUCHLINE_DIR may only contain letters, digits and ._/-" >&2; exit 2; }

sha=$(git rev-parse --verify "$ref^{commit}")
rev=${sha:0:12}
[ "$ref" != HEAD ] || [ -z "$(git status --porcelain --untracked-files=no)" ] \
  || echo "Note: uncommitted changes are not deployed." >&2

if [ -n "$build" ]; then
  args=$rev
  echo ">> deploy $rev to $host:~/$dir (build on the host)"
else
  args="$rev --pull $sha"
  echo ">> deploy $rev to $host:~/$dir (pull ghcr.io/carlossardo/touchline:sha-$sha)"
fi
# shellcheck disable=SC2029 # $dir and $args expand here on purpose (validated above)
git archive --format=tar "$rev" | ssh "$host" \
  "set -e; mkdir -p ~/$dir; cd ~/$dir; rm -rf src.new; mkdir src.new; tar -x -C src.new; exec bash src.new/deploy/host-deploy.sh $args"
