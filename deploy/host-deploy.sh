#!/usr/bin/env bash
# Runs on the host, started by scripts/deploy.sh in the deploy directory (for example ~/touchline) with
# the new source unpacked in ./src.new. Builds local/touchline:<rev> + :latest (docker buildx), installs
# deploy/compose.external-postgres.yaml as ./compose.yaml, creates or checks the account registry,
# migrates registered worlds, starts the app and checks /api/health.
# A failed build leaves the running container untouched. Roll back by restoring a database backup,
# not by running an older image against migrated data.
set -euo pipefail
rev=${1:?Usage: deploy/host-deploy.sh <revision> (started by scripts/deploy.sh)}
[ -d src.new ] || { echo "Run from the deploy directory with the source in ./src.new" >&2; exit 2; }
docker buildx version >/dev/null 2>&1 || { echo "docker buildx is missing (Ubuntu: sudo apt-get install docker-buildx)" >&2; exit 1; }
[ -f .env ] || { echo "No .env in $PWD: create it first, see .env.example and README (Deploying from a checkout)" >&2; exit 1; }

# The image is built here, so compose must run it and never try to pull it.
[ -z "$(tail -c 1 .env)" ] || echo >> .env
image=$(sed -n 's/^TOUCHLINE_IMAGE=//p' .env | tail -n 1)
case "$image" in
  "") echo 'TOUCHLINE_IMAGE=local/touchline:latest' >> .env ;;
  local/touchline:latest) ;;
  *) echo "TOUCHLINE_IMAGE in .env is $image; a deploy from source runs local/touchline:latest" >&2; exit 1 ;;
esac
grep -q '^TOUCHLINE_PULL_POLICY=never$' .env || echo 'TOUCHLINE_PULL_POLICY=never' >> .env

rm -rf src && mv src.new src
echo ">> build local/touchline:$rev (a few minutes on a Raspberry Pi)"
docker buildx build --load --build-arg SOURCE_REVISION="$rev" -t "local/touchline:$rev" -t local/touchline:latest src
cp src/deploy/compose.external-postgres.yaml compose.yaml

run() { docker compose run --rm --no-deps -T app "$@"; }
echo ">> account registry"
run npm run --silent accounts:migrate -- --apply --yes
echo ">> world migrations"
run npm run --silent db:migrate -- --registered --apply --yes

echo ">> start"
docker compose up -d --wait
curl -fsS "http://$(docker compose port app 3001)/api/health" && echo
# Keep the three newest builds.
docker image ls local/touchline --format '{{.Tag}}' | grep -vx latest | tail -n +4 \
  | xargs -r -I{} docker image rm "local/touchline:{}" >/dev/null
