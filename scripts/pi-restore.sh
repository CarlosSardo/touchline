#!/usr/bin/env bash
# Replaces the Touchline database of the compose stack with a scripts/pi-backup.sh dump.
# Stops the app, takes a safety backup of the current database first (unless --no-safety-backup),
# recreates the database owned by the app role, restores the dump and starts the app again.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
usage() { printf 'Usage: scripts/pi-restore.sh BACKUP.dump --yes [--no-safety-backup]\n' >&2; exit 2; }
fail() { printf 'Restore failed: %s\n' "$*" >&2; exit 1; }

file=""; yes=false; safety=true
while (( $# )); do
  case "$1" in
    --yes) yes=true ;;
    --no-safety-backup) safety=false ;;
    -h|--help) usage ;;
    -*) usage ;;
    *) [[ -z "$file" ]] || usage; file="$1" ;;
  esac
  shift
done
[[ -n "$file" ]] || usage
[[ -f "$file" ]] || fail "$file does not exist."
command -v docker >/dev/null || fail "docker is required."
docker compose exec -T postgres pg_isready -q -U postgres || fail "the postgres service is not running (docker compose up -d postgres)."
docker compose exec -T postgres pg_restore --list < "$file" > /dev/null || fail "$file is not a readable pg_dump custom-format file."
if [[ "$yes" != true ]]; then
  printf 'This REPLACES every career, save and account in the database with %s.\nRerun with --yes to continue.\n' "$file" >&2
  exit 1
fi
[[ "$safety" != true ]] || bash scripts/pi-backup.sh

docker compose stop app
docker compose exec -T postgres sh -c '
  set -e
  owner="${TOUCHLINE_APP_USER:-$POSTGRES_USER}"
  psql -v ON_ERROR_STOP=1 --no-psqlrc -q -U postgres -d postgres --set db="$POSTGRES_DB" --set owner="$owner" <<SQL
DROP DATABASE IF EXISTS :"db" WITH (FORCE);
CREATE DATABASE :"db" OWNER :"owner" TEMPLATE template0 ENCODING UTF8 LOCALE_PROVIDER builtin BUILTIN_LOCALE '"'"'C.UTF-8'"'"';
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"owner";
SQL
' || fail "could not recreate the database; the app is stopped. Fix the cause and rerun."
docker compose exec -T postgres sh -c 'exec pg_restore -U postgres -d "$POSTGRES_DB" --exit-on-error --single-transaction' < "$file" ||
  fail "pg_restore returned an error; the app is stopped. Rerun with another backup."
docker compose exec -T postgres sh -c 'exec vacuumdb -U postgres -d "$POSTGRES_DB" --analyze-only --quiet'
docker compose start app
printf 'Restored %s and restarted the app.\n' "$file"
