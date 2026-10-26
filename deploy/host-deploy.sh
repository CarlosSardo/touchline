#!/usr/bin/env bash
# Runs on the host, started by scripts/deploy.sh in the deploy directory (for example ~/touchline) with
# the new source unpacked in ./src.new. Gets local/touchline:<rev> + :latest, installs
# deploy/compose.external-postgres.yaml as ./compose.yaml, creates or checks the account registry,
# migrates registered worlds, starts the app and checks /api/health.
#   host-deploy.sh <rev>                    builds the image from ./src.new (docker buildx)
#   host-deploy.sh <rev> --pull <commit>    pulls ghcr.io/carlossardo/touchline:sha-<commit> with the
#     host's `docker login ghcr.io` and refuses it unless its org.opencontainers.image.revision is <commit>
# A failed build or pull leaves the running container untouched. Roll back by restoring a database
# backup, not by running an older image against migrated data.
set -euo pipefail
rev=${1:?Usage: deploy/host-deploy.sh <revision> [--pull <commit>] (started by scripts/deploy.sh)}
sha=
if [ "${2:-}" = --pull ]; then
  sha=${3:-}
  [[ $sha =~ ^[0-9a-f]{40}$ && ${sha:0:12} == "$rev" ]] || { echo "--pull needs the full commit of $rev" >&2; exit 2; }
fi
[ -d src.new ] || { echo "Run from the deploy directory with the source in ./src.new" >&2; exit 2; }
[ -n "$sha" ] || docker buildx version >/dev/null 2>&1 \
  || { echo "docker buildx is missing (Ubuntu: sudo apt-get install docker-buildx)" >&2; exit 1; }
[ -f .env ] || { echo "No .env in $PWD: create it first, see .env.example and README (Deploying from a checkout)" >&2; exit 1; }
# Without it compose falls back to port 3001 and the reverse proxy in front loses the app (502).
grep -Eq '^TOUCHLINE_PORT=[0-9]+$' .env || {
  echo "Set TOUCHLINE_PORT in $PWD/.env to the loopback port your reverse proxy forwards to; nothing was changed." >&2
  exit 1
}

# Pull and check the CI image before changing anything here.
if [ -n "$sha" ]; then
  remote=ghcr.io/carlossardo/touchline:sha-$sha
  echo ">> pull $remote"
  out=$(docker pull -q "$remote" 2>&1) || {
    echo "$out" >&2
    echo "Could not pull $remote; nothing was changed. Either:" >&2
    echo "- the image does not exist yet: CI publishes it for commits on main (.github/workflows/image.yml)," >&2
    echo "  so wait for the image workflow, or build on the host with scripts/deploy.sh --build <host> <ref>; or" >&2
    echo "- this host is not logged in to GHCR: docker login ghcr.io -u <github user>, with a classic personal" >&2
    echo "  access token that has only read:packages (see README, Deploying from a checkout)." >&2
    exit 1
  }
  label=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$remote")
  if [ "$label" != "$sha" ]; then
    docker image rm "$remote" >/dev/null 2>&1 || true
    echo "Refusing $remote: its org.opencontainers.image.revision is '$label', not $sha; nothing was changed." >&2
    exit 1
  fi
  digests=$(docker image inspect -f '{{ join .RepoDigests " " }}' "$remote")
  echo ">> $digests"
fi

# The image is built or tagged here, so compose must run it and never try to pull it.
[ -z "$(tail -c 1 .env)" ] || echo >> .env
image=$(sed -n 's/^TOUCHLINE_IMAGE=//p' .env | tail -n 1)
case "$image" in
  "") echo 'TOUCHLINE_IMAGE=local/touchline:latest' >> .env ;;
  local/touchline:latest) ;;
  *) echo "TOUCHLINE_IMAGE in .env is $image; a deploy from a checkout runs local/touchline:latest" >&2; exit 1 ;;
esac
grep -q '^TOUCHLINE_PULL_POLICY=never$' .env || echo 'TOUCHLINE_PULL_POLICY=never' >> .env

rm -rf src && mv src.new src
if [ -z "$sha" ]; then
  echo ">> build local/touchline:$rev (a few minutes on a Raspberry Pi)"
  docker buildx build --load --build-arg SOURCE_REVISION="$rev" -t "local/touchline:$rev" -t local/touchline:latest src
else
  docker tag "$remote" "local/touchline:$rev"
  docker tag "$remote" local/touchline:latest
  # Leave only the local/touchline tags on the image, so the pruning below also frees it.
  for ref in "$remote" $digests; do docker image rm "$ref" >/dev/null 2>&1 || true; done
fi
cp src/deploy/compose.external-postgres.yaml compose.yaml

run() { docker compose run --rm --no-deps -T app "$@"; }
echo ">> account registry"
run npm run --silent accounts:migrate -- --apply --yes
echo ">> world migrations"
run npm run --silent db:migrate -- --registered --apply --yes

echo ">> start"
docker compose up -d --wait
curl -fsS "http://$(docker compose port app 3001)/api/health" && echo
[ -z "$sha" ] || echo ">> deployed $rev from $digests"
# Keep the three newest builds.
docker image ls local/touchline --format '{{.Tag}}' | grep -vx latest | tail -n +4 \
  | xargs -r -I{} docker image rm "local/touchline:{}" >/dev/null
