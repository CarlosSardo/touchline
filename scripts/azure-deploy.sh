#!/usr/bin/env bash
set -euo pipefail
set +x

deploy_usage() {
  printf '%s\n' \
    'Usage: bash scripts/azure-deploy.sh --yes [--stage-only] [--skip-db-prepare] [--verification full|smoke] [--image ghcr.io/OWNER/IMAGE@sha256:DIGEST]' \
    '--stage-only builds/publishes and configures internal-only maintenance mode without opening SQL or enabling gameplay.' \
    '--skip-db-prepare skips SQL export, migrations and runtime grants for an already-prepared database; schema compatibility is still checked.' \
    'Runs SQL-backed verification first. Without --image, builds locally, pushes privately and resolves the pushed digest.' \
    '--verification smoke runs a fresh build and read-only live API checks; it does not certify the full regression suite. Default: full.' \
    'Requires existing provisioned SQL, an initialized world, UMI and Consumption environment; never seeds.' \
    'Required env: GHCR_USER, GHCR_PULL_TOKEN (or GHCR_TOKEN), AUTH_CLIENT_ID, AUTH_CLIENT_SECRET.' \
    'Building also requires GHCR_TOKEN with read:packages/write:packages and working Docker permissions.' \
    'Prefer a separate read:packages-only GHCR_PULL_TOKEN. Supply secrets locally, never in chat or CLI arguments.' \
    'Optional AUTH_SMOKE_TOKEN: owner access token for the configured app audience; never acquired automatically.' \
    'Optional ALLOWED_USER_OBJECT_IDS: comma-separated guest object IDs; unset preserves the deployed list, empty removes guests.' \
    'Register the single-tenant auth app and its HTTPS /.auth/login/aad/callback web redirect yourself.' \
    'SQL access uses scripts/azure-sql.sh; backup precedes explicit migration and runtime authorization.' \
    'Runtime SQL permissions use a constrained identity-reseeding helper; no database-owner role is granted.' \
    'Reconciles exact advertised egress IP rules named touchline-app-<ip>; never enables blanket Azure SQL access.' \
    'Cold candidates use ARM/SQL checks followed by guarded HTTP readiness; other revisions are retained inactive.' \
    'Writes .touchline-deployment.json on success; this file must be ignored by Git.' \
    'Failures after app modification leave ingress internal. Rollback never restores data.'
}

deployment_sql() {
  [[ -f scripts/azure-sql.sh ]] || fail 'scripts/azure-sql.sh is required; no direct SQL/firewall fallback is permitted.'
  env -u AZURE_CLIENT_ID -u GHCR_TOKEN -u GHCR_PULL_TOKEN -u AUTH_CLIENT_SECRET -u AUTH_SMOKE_TOKEN \
    bash scripts/azure-sql.sh "$@"
}

deployment_readonly_smoke() {
  deployment_sql -- node --import tsx --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import request from 'supertest';
import {Store} from './server/db.ts';
import {createApp} from './server/app.ts';
const store=await Store.open();
try {
  const before=await store.meta('state');
  const app=await createApp(store);
  for(const path of ['/api/health/details','/api/bootstrap','/api/dashboard','/api/players?pageSize=10','/api/saves']) {
    const response=await request(app).get(path);
    assert.equal(response.status,200,`Read-only ${path} failed`);
    if(path==='/api/health/details') {
      assert.equal(response.body.testCareer,false);
      assert.equal(response.body.schema,'dbo');
      assert.equal(response.body.databaseName,process.env.AZURE_SQL_DATABASE);
    }
    console.log(`[smoke] GET ${path}: 200`);
  }
  assert.deepEqual(await store.meta('state'),before,'Smoke checks must not alter the career');
  console.log('[smoke] Active career unchanged; complete gameplay/browser regression not rerun.');
} finally { await store.close(); }
NODE
}

deployment_logging_check() {
  node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{
    const logs=JSON.parse(text).properties?.appLogsConfiguration;
    if(!logs || ![null,"none"].includes(logs.destination) || logs.logAnalyticsConfiguration!=null) process.exit(1);
  });'
}

deployment_auth_check() {
  azure containerapp auth show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --output json |
    node -e 'let text=""; process.stdin.on("data", chunk => text+=chunk); process.stdin.on("end", () => {
      const response=JSON.parse(text), config=response.properties ?? response;
      const provider=config.identityProviders?.azureActiveDirectory;
      const enabled=Object.entries(config.identityProviders ?? {}).filter(([,value])=>value?.enabled).map(([name])=>name);
      if(config.platform?.enabled!==true || config.globalValidation?.unauthenticatedClientAction!=="RedirectToLoginPage" ||
        config.globalValidation?.redirectToProvider || enabled.length!==1 || enabled[0]!=="azureActiveDirectory" ||
        config.globalValidation?.excludedPaths?.length!==1 || config.globalValidation.excludedPaths[0]!=="/api/health" ||
        provider?.enabled!==true || provider.registration?.clientId!==process.env.AUTH_CLIENT_ID ||
        provider.registration?.openIdIssuer!==`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0` ||
        provider.registration?.clientSecretSettingName!=="entra-client-secret" || config.httpSettings?.requireHttps!==true)
        process.exit(1);
    });' || fail 'EasyAuth configuration did not match the required tenant, client and authenticated sign-in policy.'
}

deployment_guest_allowlist() {
  node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{
    const app=JSON.parse(text);
    const container=app?.properties?.template?.containers?.find(item=>item.name===process.env.AZURE_APP);
    const current=container?.env?.find(item=>item.name==="ALLOWED_USER_OBJECT_IDS")?.value ?? "";
    const ids=(process.env.ALLOWED_USER_OBJECT_IDS ?? current).split(",").map(value=>value.trim().toLowerCase()).filter(Boolean);
    if(ids.length>100 || ids.some(value=>!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(value)))
      throw new Error("ALLOWED_USER_OBJECT_IDS must contain at most 100 Entra object UUIDs.");
    process.stdout.write([...new Set(ids)].join(","));
  });'
}

deployment_candidate_check() {
  local revision="$1" origin="$2" candidate
  printf '%s\n' '[candidate] Checking immutable revision configuration without requiring a running replica.'
  candidate="$(azure containerapp revision show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision "$revision" --output json)"
  DEPLOY_CANDIDATE="$candidate" DEPLOY_ORIGIN="$origin" DEPLOY_SCHEMA="$schema_version" DEPLOY_MAINTENANCE="${stage_only:-false}" node --input-type=module <<'NODE'
const environment=process.env, template=JSON.parse(environment.DEPLOY_CANDIDATE).properties?.template;
const container=template?.containers?.[0], entries=container?.env ?? [];
const values=Object.fromEntries(entries.map(item=>[item.name,item.value]));
const expected={NODE_ENV:'production',API_HOST:'0.0.0.0',API_PORT:'3001',REQUIRE_AUTH:'true',
  AZURE_TENANT_ID:environment.AZURE_TENANT_ID,APP_ORIGIN:environment.DEPLOY_ORIGIN,
  ALLOWED_USER_OBJECT_IDS:environment.ALLOWED_USER_OBJECT_IDS,
  SQL_SERVER:`${environment.AZURE_SQL_SERVER}.database.windows.net`,SQL_DATABASE:environment.AZURE_SQL_DATABASE,
  SQL_SCHEMA:'dbo',SQL_PORT:'1433',SQL_ENCRYPT:'true',SQL_TRUST_SERVER_CERTIFICATE:'false',
  TOUCHLINE_SCHEMA_VERSION:environment.DEPLOY_SCHEMA,TOUCHLINE_MAINTENANCE:environment.DEPLOY_MAINTENANCE};
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
if(template?.containers?.length!==1 || container.name!==environment.AZURE_APP ||
   !container.image?.startsWith(`${environment.GHCR_IMAGE}@sha256:`) || !/@sha256:[a-f0-9]{64}$/.test(container.image) ||
   (template.scale?.minReplicas ?? 0)!==0 || template.scale?.maxReplicas!==1 ||
   Object.entries(expected).some(([name,value])=>values[name]!==value) ||
   !uuid.test(values.OWNER_OBJECT_ID ?? '') || !uuid.test(values.AZURE_CLIENT_ID ?? '') ||
   values.SQL_TEST_MODE==='true' || values.SQL_ALLOW_REMOTE_TESTS==='true' ||
   entries.some(item=>['SQL_USER','SQL_PASSWORD','SQL_TEST_DATABASE','TOUCHLINE_E2E_SCHEMA','CONTAINER_APP_NAME'].includes(item.name)))
  throw new Error('Candidate must retain owner authentication, the selected SQL target/schema, private digest and 0..1 scale.');
NODE
}

deployment_schema_check() {
  printf '%s\n' '[sql] Checking the recorded candidate schema version through operator access.'
  deployment_sql -- node --import tsx --input-type=module -e 'const {Store}=await import("./server/db.ts"); const store=await Store.open(); try { const row=await store.get("SELECT MAX(version) AS version FROM schema_migrations"); if(String(row?.version)!==process.argv[1]) throw new Error("Candidate schema mismatch; database downgrade/restore is never automatic."); } finally { await store.close(); }' "$1"
}

deployment_firewall() {
  local outbound rules plan operation rule_name address
  printf '%s\n' '[sql-firewall] Waiting up to 180 seconds for advertised ACA egress; SQL startup may initially retry.'
  azure resource wait --ids "$app_id" --api-version 2024-03-01 \
    --custom 'length(properties.outboundIpAddresses || `[]`) > `0`' --interval 5 --timeout 180 --output none
  outbound="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.outboundIpAddresses --output json)"
  rules="$(azure sql server firewall-rule list --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" --output json)"
  plan="$(DEPLOY_OUTBOUND="$outbound" DEPLOY_FIREWALL="$rules" node --input-type=module <<'NODE'
import {isIP} from 'node:net';
const outbound=JSON.parse(process.env.DEPLOY_OUTBOUND), rules=JSON.parse(process.env.DEPLOY_FIREWALL);
if(!Array.isArray(outbound) || !outbound.length || !Array.isArray(rules) ||
   outbound.some(address=>typeof address!=='string' || isIP(address)!==4 || address==='0.0.0.0'))
  throw new Error('Advertised egress must be a nonempty list of exact IPv4 addresses; blanket SQL access is forbidden.');
const addresses=[...new Set(outbound)].sort(), prefix='touchline-app-';
const owned=rules.filter(rule=>typeof rule.name==='string' && rule.name.startsWith(prefix) && isIP(rule.name.slice(prefix.length))===4);
if(owned.some(rule=>rule.startIpAddress!==rule.name.slice(prefix.length) || rule.endIpAddress!==rule.startIpAddress))
  throw new Error('An owned firewall name has unexpected IP bounds; operator review is required before changing rules.');
for(const address of addresses)
  if(!rules.some(rule=>rule.name===`${prefix}${address}`)) console.log(`create\t${prefix}${address}\t${address}`);
for(const rule of owned)
  if(!addresses.includes(rule.startIpAddress)) console.log(`delete\t${rule.name}\t${rule.startIpAddress}`);
NODE
)" || fail 'Egress/firewall metadata validation failed; no SQL firewall rules changed.'
  printf '%s\n' '[sql-firewall] Adding missing exact-IP rules, then pruning only stale touchline-app-<ip> rules.'
  while IFS=$'\t' read -r operation rule_name address; do
    case "$operation" in
      create) azure sql server firewall-rule create --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" \
        --name "$rule_name" --start-ip-address "$address" --end-ip-address "$address" --output none ;;
      delete) azure sql server firewall-rule delete --resource-group "$AZURE_RESOURCE_GROUP" --server "$AZURE_SQL_SERVER" \
        --name "$rule_name" --output none ;;
      '') ;;
      *) fail 'Unexpected SQL firewall operation.' ;;
    esac
  done <<<"$plan"
}

deployment_traffic_check() {
  azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --output json |
    DEPLOY_REVISION="$1" DEPLOY_EXTERNAL="$2" node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{
      const config=JSON.parse(text).properties?.configuration, ingress=config?.ingress, traffic=ingress?.traffic;
      if(config?.activeRevisionsMode!=="Multiple" || ingress?.external!==(process.env.DEPLOY_EXTERNAL==="true") ||
        ingress?.targetPort!==3001 || ingress?.allowInsecure===true || traffic?.length!==1 ||
        traffic[0].revisionName!==process.env.DEPLOY_REVISION || traffic[0].latestRevision===true || traffic[0].weight!==100) process.exit(1);
    });' || fail 'Ingress and 100% selected-revision traffic were not confirmed.'
}

deployment_deactivate_others() {
  local selected="$1" active other
  deployment_traffic_check "$selected" true
  printf '%s\n' '[revisions] Traffic verified; retaining every nonselected revision inactive for rollback.'
  active="$(azure containerapp revision list --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query '[?properties.active].name' --output tsv)"
  while IFS= read -r other; do
    if [[ -n "$other" && "$other" != "$selected" ]]; then
      azure containerapp revision deactivate --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision "$other" --output none
    fi
  done <<<"$active"
  active="$(azure containerapp revision list --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query '[?properties.active].name' --output tsv)"
  [[ "$active" == "$selected" ]] || fail 'Expected only the selected revision to remain active.'
}

deployment_wait() {
  local revision="$1"
  printf '%s\n' '[readiness] Waiting up to 300 seconds for selected-revision readiness after HTTP wake-up.'
  azure containerapp revision show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" \
    --revision "$revision" --output json >/dev/null
  azure resource wait --ids "${app_id}/revisions/${revision}" --api-version 2024-03-01 \
    --custom "properties.healthState=='Healthy' && properties.provisioningState=='Provisioned'" \
    --interval 5 --timeout 300 --output none
}

deployment_public_check() {
  DEPLOY_ORIGIN="$1" AUTH_SMOKE_TOKEN="$smoke_token" node --input-type=module <<'NODE'
import { setTimeout } from 'node:timers/promises';
const origin=process.env.DEPLOY_ORIGIN;
const deadline=Date.now()+300000;
let healthy=false, attempt=0;
while(Date.now()<deadline) {
  attempt++;
  if(attempt===1 || attempt%10===0) console.log(`[readiness] Guarded HTTP wake/health attempt ${attempt} (300-second deadline; SQL startup may retry).`);
  try {
    const response=await fetch(`${origin}/api/health`, {redirect:'manual', signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))});
    if(response.status===200 && (await response.json()).status==='ok') { healthy=true; break; }
  } catch {}
  const delay=Math.min(2000,deadline-Date.now());
  if(delay>0) await setTimeout(delay);
}
if(!healthy) throw new Error('Public health did not become ready within 300 seconds; ingress will close.');
for(const path of ['/','/api/health/details']) {
  const headers=path==='/' ? {Accept:'text/html','User-Agent':'Mozilla/5.0'} : {Accept:'application/json'};
  const denied=await fetch(`${origin}${path}`, {redirect:'manual', headers, signal:AbortSignal.timeout(15000)});
  if(path!=='/' && [401,403].includes(denied.status)) continue;
  const location=denied.headers.get('location');
  const login=location ? new URL(location,origin) : null;
  const expectedLogin=login && ((login.origin===origin && login.pathname==='/.auth/login/aad') ||
    (login.origin==='https://login.microsoftonline.com' && login.pathname.startsWith(`/${process.env.AZURE_TENANT_ID}/`)));
  if(denied.status!==302 || !expectedLogin) throw new Error('Anonymous game/API access must redirect to the configured sign-in provider.');
}
if(process.env.AUTH_SMOKE_TOKEN) {
  const response=await fetch(`${origin}/api/health/details`, {
    redirect:'manual', signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${process.env.AUTH_SMOKE_TOKEN}`},
  });
  if(response.status!==200) throw new Error('Owner smoke token was rejected.');
  const details=await response.json();
  if(details.status!=='ok' || details.hosted!==true || details.testCareer!==false || details.schema!=='dbo' ||
     details.databaseName!==process.env.AZURE_SQL_DATABASE || !details.date)
    throw new Error('Owner smoke returned an unexpected SQL target or uninitialized world.');
}
console.log(`PUBLIC_HEALTH_OK SIGN_IN_REQUIRED ownerSmokeVerified=${Boolean(process.env.AUTH_SMOKE_TOKEN)}`);
NODE
}

deployment_private_registry() {
  node --input-type=module <<'NODE'
const repository=process.env.GHCR_IMAGE.slice('ghcr.io/'.length);
const response=await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`, {signal:AbortSignal.timeout(20000)});
if([401,403].includes(response.status)) process.exit(0);
if(response.status!==200) throw new Error('Cannot establish private GHCR access policy.');
const {token}=await response.json();
if(!token) throw new Error('GHCR returned no anonymous access result.');
const tags=await fetch(`https://ghcr.io/v2/${repository}/tags/list`, {headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(20000)});
if(![401,403].includes(tags.status)) throw new Error('GHCR repository is public or its privacy cannot be established. Refusing to push/deploy.');
NODE
}

deployment_main() {
  local consent='' image='' stage_only=false verification=full skip_db_prepare=false
  while (( $# )); do
    case "$1" in
      --help|-h) deploy_usage; return ;;
      --yes) consent=--yes; shift ;;
      --stage-only) stage_only=true; shift ;;
      --skip-db-prepare) skip_db_prepare=true; shift ;;
      --verification) [[ $# -ge 2 ]] || { deploy_usage >&2; return 2; }; verification="$2"; shift 2 ;;
      --image) [[ $# -ge 2 ]] || { deploy_usage >&2; return 2; }; image="$2"; shift 2 ;;
      *) deploy_usage >&2; return 2 ;;
    esac
  done
  source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
  [[ "$verification" == full || "$verification" == smoke ]] || fail '--verification must be full or smoke.'
  [[ "$consent" == --yes ]] || fail 'Deployment requires --yes. Use --help to review prerequisites.'
  [[ "$GHCR_IMAGE" =~ ^ghcr\.io/[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$ ]] || fail 'GHCR_IMAGE must be an untagged private ghcr.io repository.'
  if [[ -n "$image" ]]; then
    [[ "$image" == "$GHCR_IMAGE"@sha256:* && "${image##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || fail '--image must pin the configured private GHCR repository to a sha256 digest.'
  fi
  [[ "${AUTH_CLIENT_ID:-}" =~ ^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$ ]] || fail 'Set AUTH_CLIENT_ID for your existing single-tenant Entra application.'
  [[ -n "${AUTH_CLIENT_SECRET:-}" && -n "${GHCR_USER:-}" && -n "${GHCR_PULL_TOKEN:-${GHCR_TOKEN:-}}" ]] || fail 'Supply AUTH_CLIENT_SECRET, GHCR_USER and GHCR_PULL_TOKEN (or GHCR_TOKEN) locally.'
  local pull_token="${GHCR_PULL_TOKEN:-${GHCR_TOKEN:-}}" push_token="${GHCR_TOKEN:-}" auth_secret="$AUTH_CLIENT_SECRET"
  local smoke_token="${AUTH_SMOKE_TOKEN:-}" app_id
  declare -g temp_dir='' touched=false completed=false
  unset GHCR_TOKEN GHCR_PULL_TOKEN AUTH_CLIENT_SECRET AUTH_SMOKE_TOKEN AZURE_CLIENT_ID
  export AUTH_CLIENT_ID GHCR_USER
  [[ -n "$image" || -n "$push_token" ]] || fail 'GHCR_TOKEN with read:packages/write:packages is required to push.'
  need node
  need npm
  [[ -f scripts/azure-sql.sh ]] || fail 'Main must provide scripts/azure-sql.sh before deployment.'
  printf '%s\n' '[deploy] Checking target, SQL free limits, managed identity and private registry.'
  check_target
  confirm_target "$consent"
  verify_free_database
  sql_environment
  local owner identity identity_id identity_client environment environment_id public_domain previous_revision='' schema_version
  owner="$(azure ad signed-in-user show --query id --output tsv)"
  [[ "$owner" =~ ^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$ ]] || fail 'An interactive owner Azure sign-in is required.'
  identity="$(azure identity show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_IDENTITY" --output json)"
  identity_id="$(printf '%s' "$identity" | json_value id)"
  identity_client="$(printf '%s' "$identity" | json_value clientId)"
  environment="$(azure containerapp env show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_ENVIRONMENT" --output json)"
  environment_id="$(printf '%s' "$environment" | json_value id)"
  public_domain="$(printf '%s' "$environment" | json_value properties.defaultDomain)"
  [[ "$public_domain" == *.azurecontainerapps.io && "$public_domain" != *[/:[:space:]]* && "$public_domain" != internal.* ]] || fail 'A public-capable Container Apps environment DNS suffix is required.'
  printf '%s' "$environment" | deployment_logging_check || fail 'Environment must have disabled log storage and no Log Analytics workspace.'
  deployment_private_registry
  local stamp backup=''
  stamp="$(date -u +%Y%m%d%H%M%S)-$$"
  if [[ "$stage_only" == true ]]; then
    printf '%s\n' '[stage] Internal-only maintenance deployment. No career or SQL permission changes; public promotion remains disabled.'
  else
    printf '%s\n' '[verify] Checking the initialized world, then running isolated SQL-backed verification.'
    deployment_sql -- node --import tsx --input-type=module -e 'const {Store}=await import("./server/db.ts"); const {stateOf}=await import("./server/systems.ts"); const store=await Store.open(); try { if(!(await stateOf(store))?.date || !(await store.get("SELECT TOP(1) id FROM clubs"))) throw new Error("Load an initialized world before deployment; no seed is performed."); } finally { await store.close(); }'
    if [[ "$verification" == full ]]; then
      deployment_sql --tests -- npm run verify
    else
      printf '%s\n' '[verify] Focused release checks selected; full gameplay/browser regression will not be rerun.'
      npm run build
      deployment_readonly_smoke
    fi
    if [[ "$skip_db_prepare" == true ]]; then
      printf '%s\n' '[deploy] Using the prepared database; SQL export, migrations and runtime grants skipped.'
    else
      backup=".azure/backups/pre-deploy-${stamp}.touchline.gz"
      mkdir -p .azure/backups
      printf '%s\n' '[backup] Exporting SQL before migration or permission changes.'
      deployment_sql -- node --import tsx scripts/data-export.ts --out "$backup"
      printf '%s\n' '[migrate] Applying explicit migrations, then constrained runtime grants.'
      deployment_sql -- node --import tsx scripts/db-migrate.ts --apply --yes
      deployment_sql -- node --import tsx scripts/db-authorize.ts --client-id "$identity_client" --name "$AZURE_IDENTITY" --apply --yes
    fi
  fi
  schema_version="$(node --import tsx --input-type=module -e 'import {schemaMigrations} from "./server/sql-schema.ts"; console.log(schemaMigrations("dbo").at(-1).version)')"
  umask 077
  temp_dir="$(mktemp -d)"
  app_id="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$AZURE_RESOURCE_GROUP/providers/Microsoft.App/containerApps/$AZURE_APP"
  trap 'status=$?; trap - EXIT; if [[ "$touched" == true && "$completed" != true ]]; then azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type internal --target-port 3001 --transport auto --output none >/dev/null 2>&1 || printf "%s\n" "CRITICAL: Could not close ingress after failure; close it manually immediately." >&2; fi; rm -rf -- "$temp_dir"; exit "$status"' EXIT
  if [[ -z "$image" ]]; then
    printf '%s\n' '[image] Building locally and pushing to private GHCR.'
    need docker
    docker info >/dev/null 2>&1 || fail 'Docker permission/daemon check failed. No build or push attempted.'
    local tag="$GHCR_IMAGE:local-$(git rev-parse --short HEAD)-$stamp"
    bash scripts/build.sh "$tag"
    mkdir "$temp_dir/docker"
    printf '%s' "$push_token" | DOCKER_CONFIG="$temp_dir/docker" docker login ghcr.io --username "$GHCR_USER" --password-stdin >/dev/null 2>&1 || fail 'Private GHCR login failed.'
    DOCKER_CONFIG="$temp_dir/docker" docker push "$tag"
    image="$(docker image inspect "$tag" --format '{{json .RepoDigests}}' | node -e 'let text=""; process.stdin.on("data",chunk=>text+=chunk); process.stdin.on("end",()=>{ const digest=JSON.parse(text).find(value=>value.startsWith(`${process.env.GHCR_IMAGE}@sha256:`)); if(!digest) process.exit(1); process.stdout.write(digest); });')"
  fi
  [[ "$image" == "$GHCR_IMAGE"@sha256:* && "${image##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || fail 'Registry did not return the expected immutable digest.'
  deployment_private_registry
  unset push_token
  azure containerapp list --resource-group "$AZURE_RESOURCE_GROUP" --output json >"$temp_dir/apps.json"
  APP_NAME="$AZURE_APP" DEPLOY_STAGE_ONLY="$stage_only" node --input-type=module - "$temp_dir" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const directory=process.argv[2], apps=JSON.parse(readFileSync(`${directory}/apps.json`,'utf8'));
const existing=apps.find(app=>app.name===process.env.APP_NAME);
if(existing && existing.tags?.['touchline-tooling']!=='local') throw new Error('Refusing to replace an app not managed by these scripts.');
if(existing?.properties?.configuration?.ingress?.external===true && process.env.DEPLOY_STAGE_ONLY==='true')
  throw new Error('Stage-only cannot replace an already-public app. Use the verified release workflow.');
writeFileSync(`${directory}/existing.json`, JSON.stringify(existing ?? null));
NODE
  ALLOWED_USER_OBJECT_IDS="$(deployment_guest_allowlist < "$temp_dir/existing.json")"
  export ALLOWED_USER_OBJECT_IDS
  previous_revision="$(node -e 'const app=require(process.argv[1]); process.stdout.write(app?.properties?.configuration?.ingress?.traffic?.find(item=>item.weight===100)?.revisionName ?? app?.properties?.latestReadyRevisionName ?? "")' "$temp_dir/existing.json")"
  if [[ "$(<"$temp_dir/existing.json")" != null ]]; then
    touched=true
    azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type internal --target-port 3001 --transport auto --output none
  fi
  local revision_suffix="d$stamp" revision origin fqdn
  revision="$AZURE_APP--$revision_suffix"
  origin="https://$AZURE_APP.$public_domain"
  DEPLOY_IMAGE="$image" DEPLOY_OWNER="$owner" DEPLOY_IDENTITY="$identity_id" DEPLOY_CLIENT="$identity_client" \
    DEPLOY_ENVIRONMENT="$environment_id" DEPLOY_REVISION="$revision_suffix" DEPLOY_SCHEMA="$schema_version" DEPLOY_ORIGIN="$origin" \
    DEPLOY_PULL_TOKEN="$pull_token" DEPLOY_AUTH_SECRET="$auth_secret" DEPLOY_MAINTENANCE="$stage_only" node --input-type=module - "$temp_dir" <<'NODE'
import {writeFileSync} from 'node:fs';
const environment=process.env;
const values={NODE_ENV:'production',API_HOST:'0.0.0.0',API_PORT:'3001',REQUIRE_AUTH:'true',
  OWNER_OBJECT_ID:environment.DEPLOY_OWNER,AZURE_TENANT_ID:environment.AZURE_TENANT_ID,
  ALLOWED_USER_OBJECT_IDS:environment.ALLOWED_USER_OBJECT_IDS,
  APP_ORIGIN:environment.DEPLOY_ORIGIN,AZURE_CLIENT_ID:environment.DEPLOY_CLIENT,
  SQL_SERVER:`${environment.AZURE_SQL_SERVER}.database.windows.net`,SQL_DATABASE:environment.AZURE_SQL_DATABASE,
  SQL_SCHEMA:'dbo',SQL_PORT:'1433',SQL_ENCRYPT:'true',SQL_TRUST_SERVER_CERTIFICATE:'false',
  TOUCHLINE_SCHEMA_VERSION:environment.DEPLOY_SCHEMA,TOUCHLINE_MAINTENANCE:environment.DEPLOY_MAINTENANCE};
const body={location:environment.AZURE_LOCATION,tags:{'touchline-tooling':'local'},
  identity:{type:'UserAssigned',userAssignedIdentities:{[environment.DEPLOY_IDENTITY]:{}}},
  properties:{managedEnvironmentId:environment.DEPLOY_ENVIRONMENT,workloadProfileName:'Consumption',
    configuration:{activeRevisionsMode:'Multiple',
      secrets:[{name:'ghcr-pull',value:environment.DEPLOY_PULL_TOKEN},{name:'entra-client-secret',value:environment.DEPLOY_AUTH_SECRET}],
      registries:[{server:'ghcr.io',username:environment.GHCR_USER,passwordSecretRef:'ghcr-pull'}],
      ingress:{external:false,targetPort:3001,transport:'auto',allowInsecure:false,traffic:[{latestRevision:true,weight:100}]}},
    template:{revisionSuffix:environment.DEPLOY_REVISION,containers:[{name:environment.AZURE_APP,image:environment.DEPLOY_IMAGE,
      env:Object.entries(values).map(([name,value])=>({name,value})),resources:{cpu:0.5,memory:'1Gi'},
      probes:[{type:'Readiness',httpGet:{path:'/api/health',port:3001},initialDelaySeconds:10,periodSeconds:5,failureThreshold:30}]}],
      scale:{minReplicas:0,maxReplicas:1}}}};
writeFileSync(`${process.argv[2]}/app.json`,JSON.stringify(body),{mode:0o600});
const auth={properties:{platform:{enabled:true},httpSettings:{requireHttps:true},
  globalValidation:{unauthenticatedClientAction:'RedirectToLoginPage',excludedPaths:['/api/health']},
  identityProviders:{azureActiveDirectory:{enabled:true,registration:{clientId:environment.AUTH_CLIENT_ID,
    clientSecretSettingName:'entra-client-secret',openIdIssuer:`https://login.microsoftonline.com/${environment.AZURE_TENANT_ID}/v2.0`},
    validation:{allowedAudiences:[environment.AUTH_CLIENT_ID,`api://${environment.AUTH_CLIENT_ID}`]}}}}};
writeFileSync(`${process.argv[2]}/auth.json`,JSON.stringify(auth),{mode:0o600});
NODE
  touched=true
  printf '%s\n' '[deploy] Applying the owner-guarded candidate with internal ingress and 0..1 replicas.'
  azure rest --method put --url "https://management.azure.com${app_id}?api-version=2024-03-01" --body "@$temp_dir/app.json" --output none 2>/dev/null || fail 'Container App apply failed; request details suppressed to protect credentials.'
  unset pull_token auth_secret
  deployment_firewall
  printf '%s\n' '[auth] Applying and verifying tenant-bound EasyAuth before opening ingress.'
  azure rest --method put --url "https://management.azure.com${app_id}/authConfigs/current?api-version=2024-03-01" --body "@$temp_dir/auth.json" --output none
  deployment_auth_check
  fqdn="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.fqdn --output tsv)"
  [[ "$fqdn" == "$AZURE_APP.$public_domain" || "$fqdn" == "$AZURE_APP.internal.$public_domain" ]] || fail 'Unexpected application FQDN.'
  deployment_candidate_check "$revision" "$origin"
  if [[ "$stage_only" != true ]]; then deployment_schema_check "$schema_version"; fi
  azure containerapp ingress traffic set --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --revision-weight "$revision=100" --output none
  deployment_traffic_check "$revision" false
  if [[ "$stage_only" == true ]]; then
    deployment_wait "$revision"
    DEPLOY_IMAGE="$image" DEPLOY_REVISION="$revision" DEPLOY_ORIGIN="$origin" node --input-type=module <<'NODE'
import {writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('.azure',{recursive:true});
writeFileSync('.azure/staged-app.json',JSON.stringify({app:process.env.AZURE_APP,image:process.env.DEPLOY_IMAGE,
  revision:process.env.DEPLOY_REVISION,origin:process.env.DEPLOY_ORIGIN,maintenance:true,externalIngress:false,
  stagedAt:new Date().toISOString()},null,2),{mode:0o600});
NODE
    completed=true
    printf 'Staged %s\nImage: %s\nRevision: %s\nMaintenance enabled; public ingress and gameplay remain disabled.\n' "$AZURE_APP" "$image" "$revision"
    rm -rf -- "$temp_dir"
    trap - EXIT
    return
  fi
  printf '%s\n' '[traffic] Opening protected ingress to wake and validate only the selected candidate.'
  azure containerapp ingress enable --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --type external --target-port 3001 --transport auto --output none
  fqdn="$(azure containerapp show --name "$AZURE_APP" --resource-group "$AZURE_RESOURCE_GROUP" --query properties.configuration.ingress.fqdn --output tsv)"
  if [[ "https://$fqdn" != "$origin" ]]; then
    fail 'Public FQDN differs from the environment DNS suffix. Ingress closed; investigate before retrying.'
  fi
  deployment_auth_check
  deployment_public_check "$origin"
  deployment_wait "$revision"
  deployment_deactivate_others "$revision"
  DEPLOY_IMAGE="$image" DEPLOY_REVISION="$revision" DEPLOY_PREVIOUS="$previous_revision" DEPLOY_ORIGIN="$origin" \
    DEPLOY_BACKUP="$backup" DEPLOY_SCHEMA="$schema_version" DEPLOY_VERIFICATION="$verification" DEPLOY_DB_PREPARE_SKIPPED="$skip_db_prepare" OWNER_SMOKE_VERIFIED="$([[ -n "$smoke_token" ]] && printf true || printf false)" \
    node --input-type=module <<'NODE'
import {writeFileSync,renameSync} from 'node:fs';
const environment=process.env;
const state={subscriptionId:environment.AZURE_SUBSCRIPTION_ID,resourceGroup:environment.AZURE_RESOURCE_GROUP,
  app:environment.AZURE_APP,image:environment.DEPLOY_IMAGE,revision:environment.DEPLOY_REVISION,
  previousRevision:environment.DEPLOY_PREVIOUS,origin:environment.DEPLOY_ORIGIN,backup:environment.DEPLOY_BACKUP,
  schemaVersion:Number(environment.DEPLOY_SCHEMA),verification:environment.DEPLOY_VERIFICATION,databasePreparationSkipped:environment.DEPLOY_DB_PREPARE_SKIPPED==='true',ownerSmokeVerified:environment.OWNER_SMOKE_VERIFIED==='true',recordedAt:new Date().toISOString()};
writeFileSync('.touchline-deployment.json.tmp',JSON.stringify(state,null,2)+'\n',{mode:0o600});
renameSync('.touchline-deployment.json.tmp','.touchline-deployment.json');
NODE
  completed=true
  printf 'Deployed %s\nImage: %s\nRevision: %s\nOwner login: %s/.auth/login/aad\nRegister redirect: %s/.auth/login/aad/callback\n' "$origin" "$image" "$revision" "$origin" "$origin"
  [[ -n "$smoke_token" ]] || printf '%s\n' 'Owner smoke NOT verified: manual owner sign-in is still required.'
  rm -rf -- "$temp_dir"
  trap - EXIT
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  deployment_main "$@"
fi