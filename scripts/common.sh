#!/usr/bin/env bash
set -euo pipefail
set +x

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

: "${AZURE_SUBSCRIPTION_ID:=3373ab04-1dd1-49b2-8884-3094cfd0ca06}"
: "${AZURE_TENANT_ID:=d588edc8-06a0-47ac-a9e6-aea06d1c6c25}"
: "${AZURE_LOCATION:=swedencentral}"
: "${AZURE_RESOURCE_GROUP:=rg-touchline}"
: "${AZURE_SQL_SERVER:=touchline-3373ab04}"
: "${AZURE_SQL_DATABASE:=touchline}"
: "${AZURE_SQL_CONNECTION_TYPE:=Redirect}"
: "${AZURE_APP:=touchline}"
: "${AZURE_ENVIRONMENT:=touchline-env}"
: "${AZURE_IDENTITY:=touchline-app}"
: "${GHCR_IMAGE:=ghcr.io/carlossardo/touchline}"
export AZURE_SUBSCRIPTION_ID AZURE_TENANT_ID AZURE_LOCATION AZURE_RESOURCE_GROUP
export AZURE_SQL_SERVER AZURE_SQL_DATABASE AZURE_APP AZURE_ENVIRONMENT AZURE_IDENTITY GHCR_IMAGE
export AZURE_SQL_CONNECTION_TYPE

fail() { printf '%s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "$1 is required."; }
azure() {
  case "$1" in
    ad|extension) command az "$@" --only-show-errors ;;
    *) command az "$@" --subscription "$AZURE_SUBSCRIPTION_ID" --only-show-errors ;;
  esac
}
json_value() {
  node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{let value=JSON.parse(text); for(const key of process.argv[1].split(".")) value=value?.[key]; if(value!==undefined&&value!==null) process.stdout.write(typeof value==="object"?JSON.stringify(value):String(value));});' "$1"
}
check_target() {
  need az
  need node
  [[ "$AZURE_SUBSCRIPTION_ID" =~ ^[a-fA-F0-9-]{36}$ ]] || fail "Invalid Azure subscription ID."
  [[ "$AZURE_SQL_SERVER" =~ ^[a-z][a-z0-9-]{1,61}[a-z0-9]$ ]] || fail "Invalid SQL server name."
  local actual_tenant
  actual_tenant="$(azure account show --query tenantId --output tsv)"
  [[ "$actual_tenant" == "$AZURE_TENANT_ID" ]] || fail "Azure tenant mismatch. Sign in to the intended tenant first."
  printf 'Subscription: %s\nResource group: %s\nRegion: %s\n' "$AZURE_SUBSCRIPTION_ID" "$AZURE_RESOURCE_GROUP" "$AZURE_LOCATION"
}
confirm_target() {
  [[ "${1:-}" == "--yes" ]] || fail "Review the target above, then rerun with --yes to authorize changes."
}
sql_environment() {
  export SQL_SERVER="${AZURE_SQL_SERVER}.database.windows.net" SQL_DATABASE="$AZURE_SQL_DATABASE"
  export SQL_ENCRYPT=true SQL_TRUST_SERVER_CERTIFICATE=false SQL_PORT=1433 SQL_SCHEMA=dbo
  unset SQL_USER SQL_PASSWORD SQL_TEST_MODE SQL_ALLOW_REMOTE_TESTS SQL_TEST_DATABASE GAME_DB SAVE_DIR AZURE_CLIENT_ID
}
verify_free_database() {
  local database
  database="$(azure sql db show --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --name "$AZURE_SQL_DATABASE" --output json)"
  [[ "$(printf '%s' "$database" | json_value useFreeLimit)" == "true" ]] || fail "Database is not on the SQL free offer. No changes made to its billing mode."
  [[ "$(printf '%s' "$database" | json_value freeLimitExhaustionBehavior)" == "AutoPause" ]] || fail "Database is configured for paid overage. Refusing to continue."
  [[ "$(printf '%s' "$database" | json_value maxSizeBytes)" -le 34359738368 ]] || fail "SQL storage exceeds the free-offer limit."
  # skip-allowance: SQL is never opened (azure-deploy.sh --no-sql), so an exhausted allowance cannot wake or bill it.
  [[ "${1:-}" == skip-allowance ]] || verify_free_allowance "$(printf '%s' "$database" | json_value status)"
}
# Reads the Azure Monitor metric through ARM, so the check never wakes the serverless database.
verify_free_allowance() {
  local status="$1" floor="${AZURE_SQL_MIN_FREE_VCORE_SECONDS:-2000}" window remaining
  [[ "$floor" =~ ^[0-9]+$ ]] || fail "AZURE_SQL_MIN_FREE_VCORE_SECONDS must be a whole number."
  window="$(node -e 'const now=new Date(); process.stdout.write(`${new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString()} ${now.toISOString()}`)')"
  remaining="$(azure monitor metrics list \
    --resource "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$AZURE_RESOURCE_GROUP/providers/Microsoft.Sql/servers/$AZURE_SQL_SERVER/databases/$AZURE_SQL_DATABASE" \
    --metrics free_amount_remaining --aggregation Minimum --interval PT1H \
    --start-time "${window% *}" --end-time "${window#* }" \
    --query 'value[0].timeseries[0].data[?minimum!=null] | [-1].minimum' --output tsv)" ||
    fail "Could not read the SQL free vCore allowance. No SQL connection was opened."
  if [[ -z "$remaining" ]]; then
    # The metric is only emitted while the database is online: no point this month means a new month or a new database.
    printf 'No SQL free-allowance data point yet this month (database %s); assuming the monthly reset.\n' "${status:-unknown}"
    remaining=100000
  fi
  [[ "$remaining" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail "Unexpected SQL free-allowance value. No SQL connection was opened."
  remaining="${remaining%.*}"
  printf 'SQL free allowance: about %s vCore-seconds left this month (floor %s; the metric can lag by several minutes).\n' "$remaining" "$floor"
  (( remaining >= floor )) || fail "SQL free allowance is below the floor. Refusing to wake the database; wait for the monthly reset."
}