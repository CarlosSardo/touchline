#!/usr/bin/env bash
# Deploy a commit to a Docker host that already runs PostgreSQL and a reverse proxy: the source goes
# over SSH as a tarball and the host builds the image itself, see deploy/host-deploy.sh and README
# ("Deploying from a checkout"). Only committed code is deployed.
# Usage: scripts/deploy.sh <ssh-host> [git-ref]        e.g. scripts/deploy.sh carlos@raspberrypi
#   TOUCHLINE_DIR: deploy directory on the host, relative to the SSH user's home (default: touchline)
set -euo pipefail
cd "$(dirname "$0")/.."

host=${1:?Usage: scripts/deploy.sh <ssh-host> [git-ref]}
ref=${2:-HEAD}
dir=${TOUCHLINE_DIR:-touchline}
[[ $dir =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "TOUCHLINE_DIR may only contain letters, digits and ._/-" >&2; exit 2; }

rev=$(git rev-parse --short=12 --verify "$ref^{commit}")
[ "$ref" != HEAD ] || [ -z "$(git status --porcelain --untracked-files=no)" ] \
  || echo "Note: uncommitted changes are not deployed." >&2

echo ">> deploy $rev to $host:~/$dir"
git archive --format=tar "$rev" | ssh "$host" \
  "set -e; mkdir -p ~/$dir; cd ~/$dir; rm -rf src.new; mkdir src.new; tar -x -C src.new; exec bash src.new/deploy/host-deploy.sh $rev"
