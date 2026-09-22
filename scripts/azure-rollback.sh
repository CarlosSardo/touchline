#!/usr/bin/env bash
set -euo pipefail
set +x

rollback_usage() {
  printf '%s\n' \
    'Usage: bash scripts/azure-rollback.sh --yes --revision APP--REVISION' \
    '       bash scripts/azure-rollback.sh --list' \
    'Select an existing digest-pinned revision explicitly. No build, push, migration, seed or data restore.' \
    'Requires AUTH_CLIENT_ID and the normal Azure target env. Optional AUTH_SMOKE_TOKEN for owner verification.' \
    'Refuses runtime rollback once the accounts registry exists: retained release metadata does not prove image-bound per-user isolation.' \
    'Use a reviewed forward fix; this command has no maintenance-only bypass. Never remove the registry to enable old shared-world code.' \
    'Before account provisioning only, checks dbo schema compatibility through read-only SQL metadata with operator visibility.' \
    'Checks ARM/SQL internally, then wakes cold candidates through protected HTTP ingress; failure closes ingress.' \
    'Keeps only the verified revision active, with 0..1 replicas; other revisions remain available for rollback.'
}

consent='' revision='' list=false
while (( $# )); do
  case "$1" in
    --help|-h) rollback_usage; exit 0 ;;
    --yes) consent=--yes; shift ;;
    --revision) [[ $# -ge 2 ]] || { rollback_usage >&2; exit 2; }; revision="$2"; shift 2 ;;
    --list) list=true; shift ;;
    *) rollback_usage >&2; exit 2 ;;
  esac
done
source "$(dirname -- "${BASH_SOURCE[0]}")/azure-deploy.sh"
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
check_target
if [[ "$list" == true ]]; then
  [[ -z "$revision" ]] || fail '--list cannot be combined with --revision.'
  azure containerapp revision list --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
    --query '[].{revision:name,active:properties.active,health:properties.healthState,image:properties.template.containers[0].image}' --output table
  exit 0
fi
confirm_target "$consent"
[[ "$revision" == "$AZURE_APP"--* && "$revision" =~ ^[a-z0-9-]+$ ]] || fail 'Select an exact app revision using --revision; use --list to inspect candidates.'
[[ -n "${AUTH_CLIENT_ID:-}" ]] || fail 'AUTH_CLIENT_ID is required to verify the existing EasyAuth configuration.'
export AUTH_CLIENT_ID
smoke_token="${AUTH_SMOKE_TOKEN:-}"
unset AUTH_SMOKE_TOKEN AUTH_CLIENT_SECRET GHCR_TOKEN GHCR_PULL_TOKEN AZURE_CLIENT_ID
printf '%s\n' '[rollback] Checking free limits, private registry and candidate schema without changing SQL data.'
sql_environment
verify_free_database
deployment_private_registry
app_id="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$AZURE_RESOURCE_GROUP/providers/Microsoft.App/containerApps/$AZURE_APP"
candidate="$(azure containerapp revision show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision "$revision" --output json)"
schema_version="$(printf '%s' "$candidate" | node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{const revision=JSON.parse(text), containers=revision.properties.template.containers; if(containers.length!==1) process.exit(1); const container=containers[0]; if(!container.image.startsWith(`${process.env.GHCR_IMAGE}@sha256:`) || !/@sha256:[a-f0-9]{64}$/.test(container.image)) process.exit(1); const version=container.env.find(item=>item.name==="TOUCHLINE_SCHEMA_VERSION")?.value; if(!/^\d+$/.test(version)) process.exit(1); process.stdout.write(version);});')" || fail 'Rollback requires a private digest and recorded schema version.'
deployment_schema_check "$schema_version" legacy-rollback
public_domain="$(azure containerapp env show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_ENVIRONMENT" --query properties.defaultDomain --output tsv)"
[[ "$public_domain" == *.azurecontainerapps.io && "$public_domain" != *[/:[:space:]]* && "$public_domain" != internal.* ]] || fail 'A public-capable Container Apps environment DNS suffix is required.'
origin="https://$AZURE_APP.$public_domain"
deployment_auth_check
completed=false
trap 'status=$?; trap - EXIT; if [[ "$completed" != true ]]; then azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type internal --target-port 3001 --transport auto --output none >/dev/null 2>&1 || printf "%s\n" "CRITICAL: Failed to close ingress; close it manually immediately." >&2; fi; exit "$status"' EXIT
printf '%s\n' '[rollback] Closing ingress before validating and selecting the cold candidate.'
azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type internal --target-port 3001 --transport auto --output none
deployment_candidate_check "$revision" "$origin"
deployment_firewall
deployment_schema_check "$schema_version" legacy-rollback
azure containerapp revision activate --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision "$revision" --output none
azure containerapp ingress traffic set --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision-weight "$revision=100" --output none
deployment_traffic_check "$revision" false
deployment_auth_check
printf '%s\n' '[rollback] Opening owner-protected ingress for bounded HTTP wake-up and readiness.'
azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type external --target-port 3001 --transport auto --output none
fqdn="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.fqdn --output tsv)"
[[ "https://$fqdn" == "$origin" ]] || fail 'Public FQDN does not match the candidate origin.'
deployment_auth_check
deployment_public_check "$origin"
deployment_wait "$revision"
deployment_deactivate_others "$revision"
completed=true
trap - EXIT
printf 'Rollback selected %s. SQL data and schema were not changed.\n' "$revision"
[[ -n "$smoke_token" ]] || printf 'Owner smoke NOT verified: sign in at https://%s/.auth/login/aad\n' "$fqdn"