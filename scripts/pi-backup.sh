#!/usr/bin/env bash
# Online PostgreSQL backup of the compose stack: one pg_dump custom-format file (all worlds, saves and the
# account registry) plus the cluster roles, written to BACKUP_DIR (default backups/) and pruned after
# BACKUP_RETENTION_DAYS (default 14; both also read from .env). Safe while the app runs; pg_dump reads one consistent snapshot.
# Restore with scripts/pi-restore.sh. Cron example (daily 04:15):
#   15 4 * * * cd /opt/touchline && bash scripts/pi-backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
usage() { printf 'Usage: scripts/pi-backup.sh [--dir DIR] [--keep-days N]\n' >&2; exit 2; }
fail() { printf 'Backup failed: %s\n' "$*" >&2; exit 1; }

from_env_file() { [[ -f .env ]] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }
dir="${BACKUP_DIR:-$(from_env_file BACKUP_DIR)}"
dir="${dir:-backups}"
keep="${BACKUP_RETENTION_DAYS:-$(from_env_file BACKUP_RETENTION_DAYS)}"
keep="${keep:-14}"
while (( $# )); do
  case "$1" in
    --dir) [[ $# -ge 2 ]] || usage; dir="$2"; shift 2 ;;
    --keep-days) [[ $# -ge 2 ]] || usage; keep="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ "$keep" =~ ^[0-9]+$ ]] && (( keep >= 1 )) || fail "--keep-days must be a whole number of at least 1."
command -v docker >/dev/null || fail "docker is required."
docker compose exec -T postgres pg_isready -q -U postgres || fail "the postgres service is not running (docker compose up -d postgres)."

umask 077
mkdir -p -- "$dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
while [[ -e "$dir/touchline-$stamp.dump" ]]; do
  sleep 1
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
done
dump="$dir/touchline-$stamp.dump"
roles="$dir/touchline-$stamp-roles.sql"
trap 'rm -f -- "$dump.partial" "$roles.partial"' EXIT

docker compose exec -T postgres sh -c 'exec pg_dump -U postgres -d "$POSTGRES_DB" --format=custom --compress=zstd:3' > "$dump.partial" ||
  fail "pg_dump returned an error."
docker compose exec -T postgres pg_restore --list < "$dump.partial" > /dev/null ||
  fail "the dump could not be read back."
docker compose exec -T postgres pg_dumpall -U postgres --roles-only > "$roles.partial" ||
  fail "pg_dumpall --roles-only returned an error."
mv -n -- "$dump.partial" "$dump"
mv -n -- "$roles.partial" "$roles"
printf 'Backed up to %s (%s) and %s.\n' "$dump" "$(du -h -- "$dump" | cut -f1)" "$roles"

# Prune only after a verified backup, and never the one just written.
find "$dir" -maxdepth 1 -type f \( -name 'touchline-*.dump' -o -name 'touchline-*-roles.sql' \) \
  -mtime "+$keep" ! -name "touchline-$stamp*" -print -delete | sed 's/^/Pruned /'
