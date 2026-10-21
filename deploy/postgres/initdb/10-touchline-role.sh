#!/usr/bin/env bash
# Runs once, when the postgres-data volume is initialized. Creates the app's login role (SQL_USER) as a
# non-superuser owner of the Touchline database, so it can create per-player world schemas but cannot run
# server-side programs or read files. The superuser "postgres" stays reserved for administration and backups.
set -euo pipefail

app_user="${TOUCHLINE_APP_USER:-touchline}"
if [[ "$app_user" == "$POSTGRES_USER" ]]; then
  echo "SQL_USER equals the superuser ${POSTGRES_USER}; no separate app role created." >&2
  exit 0
fi
: "${TOUCHLINE_APP_PASSWORD:?TOUCHLINE_APP_PASSWORD (SQL_PASSWORD) is required}"

psql -v ON_ERROR_STOP=1 --no-psqlrc --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set app_user="$app_user" --set app_password="$TOUCHLINE_APP_PASSWORD" --set db="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE :"db" OWNER TO :"app_user";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO :"app_user";
SQL
