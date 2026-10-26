#!/usr/bin/env bash
# Backup and world reset smoke (the world suite of scripts/ci.sh): the default world, the account registry,
# registered and unregistered worlds and a resumed backup, against the disposable CI PostgreSQL.
# Usage: scripts/ci/backup-reset-smoke.sh [LOG_DIR]   (default: ci-logs)
set -euo pipefail
logs=${1:-ci-logs}
mkdir -p "$logs"
backup="$(mktemp -d)/touchline-backup"
trap 'rm -rf -- "$(dirname -- "$backup")"' EXIT
fail() { echo "::error::$*"; exit 1; }

# The default public world: the full backup skips test schemas and test mode only allows them.
SQL_TEST_MODE=false SQL_SCHEMA=public npm run --silent db:migrate -- --apply --yes > "$logs/public-migrate.log" 2>&1
SQL_TEST_MODE=false SQL_SCHEMA=public npm run --silent db:seed -- --seed ci-reset --nations FO --squads minimum --apply --yes > "$logs/public-seed.log" 2>&1
SQL_TEST_MODE=false SQL_SCHEMA=public npm run --silent accounts:migrate -- --apply --yes > "$logs/accounts-migrate.log" 2>&1
# Production-shaped registry: one approved player with a migrated touchline_user_ world.
account=$(cat /proc/sys/kernel/random/uuid)
player_schema="touchline_user_$(echo "$account" | tr -d -)"
SQL_TEST_MODE=false SQL_SCHEMA="$player_schema" npm run --silent db:migrate -- --apply --yes > "$logs/player-migrate.log" 2>&1
ACCOUNT_ID="$account" PLAYER_SCHEMA="$player_schema" node --input-type=module -e '
  import pg from "pg";
  const client = new pg.Client({ host: process.env.SQL_HOST, port: Number(process.env.SQL_PORT), database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER, password: process.env.SQL_PASSWORD });
  await client.connect();
  await client.query(`INSERT INTO accounts.users (id, issuer, subject, username, display_name, email, game_schema, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, NULL, $6, now(), now())`,
    [process.env.ACCOUNT_ID, "https://auth.example.test", process.env.ACCOUNT_ID, "ci-player", "CI player", process.env.PLAYER_SCHEMA]);
  await client.end();
'
# A world nobody is registered for (e.g. a deleted account): --all must report and reset it too.
SQL_TEST_MODE=false SQL_SCHEMA="touchline_user_$(cat /proc/sys/kernel/random/uuid | tr -d -)" npm run --silent db:migrate -- --apply --yes > "$logs/orphan-migrate.log" 2>&1
SQL_TEST_MODE=false npm run --silent data:export -- --everything --out-dir "$backup" 2>&1 | tee "$logs/backup.log"
# An interrupted backup resumes: the same --out-dir redoes only the missing file.
rm "$backup/public/world.touchline.gz"
SQL_TEST_MODE=false npm run --silent data:export -- --everything --out-dir "$backup" 2>&1 | tee "$logs/backup-resume.log"
if ! grep -q 'Backed up public/world ' "$logs/backup-resume.log" || grep -q 'Backed up registry ' "$logs/backup-resume.log"; then
  fail "the resumed backup did not redo exactly the missing file"
fi
npm run --silent data:export -- --verify "$backup" 2>&1 | tee "$logs/backup-verify.log"
reset() { SQL_TEST_MODE=false npm run --silent world:reset -- --all "$@"; }
reset 2>&1 | tee "$logs/world-reset-dry-run.log"
if ! grep -q '"present": true' "$logs/world-reset-dry-run.log" || ! grep -q '"accounts": 1' "$logs/world-reset-dry-run.log" \
  || ! grep -q '"registered": false' "$logs/world-reset-dry-run.log"; then
  fail "world:reset --all did not see the account registry, the registered and the unregistered world"
fi
reset --apply --yes 2>&1 | tee "$logs/world-reset.log"
reset 2>&1 | tee "$logs/world-reset-after.log"
if grep -Eq '"truncate": \[$|"snapshots": [1-9]' "$logs/world-reset-after.log"; then
  fail "world:reset left rows or snapshots behind"
fi
echo "Backup and world reset smoke passed."
