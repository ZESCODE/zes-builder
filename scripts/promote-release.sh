#!/usr/bin/env bash
#
# Promote a staged Vercel deployment to production.
#
# The release workflow (`.github/workflows/release-production.yaml`) only ever
# creates a STAGED deployment. This script is the manual promotion step that
# the owner runs afterwards. It refuses to act unless every pre-flight check
# passes, and it verifies the result afterwards.
#
# Usage:
#   VERCEL_TOKEN=... VERCEL_PROJECT_ID=... VERCEL_TEAM_ID=... \
#     ./scripts/promote-release.sh dpl_XXXXXXXXXXXXXXXXXXXXXXXX
#
# Optional:
#   PRODUCTION_DOMAIN   the domain that must serve the new build (default app.zes.codes)
#   VERCEL_API_URL      the API base URL (default https://api.vercel.com)
#
# The token is read from the environment and is never written to the output.

set -euo pipefail

DEPLOYMENT_ID="${1:-}"
PRODUCTION_DOMAIN="${PRODUCTION_DOMAIN:-app.zes.codes}"
VERCEL_API_URL="${VERCEL_API_URL:-https://api.vercel.com}"

if [ -z "$DEPLOYMENT_ID" ]; then
  echo "usage: $0 <deployment-id>" >&2
  exit 2
fi

for name in VERCEL_TOKEN VERCEL_PROJECT_ID VERCEL_TEAM_ID; do
  if [ -z "${!name:-}" ]; then
    echo "missing environment variable: $name" >&2
    exit 2
  fi
done

api() {
  local path="$1"
  shift
  curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" -H "Accept: application/json" "$@"
}

api_get() {
  local path="$1"
  curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" -H "Accept: application/json" \
    "${VERCEL_API_URL}${path}"
}

fail() {
  echo "REFUSING TO CONTINUE: $1" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

echo "== pre-flight =="

deployment=$(api_get "/v13/deployments/${DEPLOYMENT_ID}") || fail "the deployment could not be read"

deployment_id=$(printf '%s' "$deployment" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const d=JSON.parse(raw);
  process.stdout.write(String(d.id ?? d.uid ?? ''));
});
")

[ -n "$deployment_id" ] || fail "the deployment ${DEPLOYMENT_ID} does not exist"

target=$(printf '%s' "$deployment" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  process.stdout.write(String(JSON.parse(raw).target ?? ''));
});
")
substate=$(printf '%s' "$deployment" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  process.stdout.write(String(JSON.parse(raw).readySubstate ?? ''));
});
")
sha=$(printf '%s' "$deployment" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const d=JSON.parse(raw);
  process.stdout.write(String(d.meta?.githubCommitSha ?? 'unknown'));
});
")

[ "$target" = "production" ] || fail "the deployment target is '${target}', expected 'production'"
[ "$substate" = "STAGED" ] || fail "the deployment is '${substate}', expected 'STAGED' (it may already be promoted)"

echo "deployment: ${deployment_id} (${sha})"

project=$(api_get "/v9/projects/${VERCEL_PROJECT_ID}?t=$(date +%s%N)")
production_id=$(printf '%s' "$project" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const p=JSON.parse(raw);
  process.stdout.write(String(p.targets?.production?.id ?? ''));
});
")
auto_assign=$(printf '%s' "$project" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const p=JSON.parse(raw);
  process.stdout.write(String(p.autoAssignCustomDomains));
});
")

[ -n "$production_id" ] || fail "no current production deployment could be read"
[ "$production_id" != "$deployment_id" ] || fail "the deployment is already the production deployment"
[ "$auto_assign" = "false" ] || fail "autoAssignCustomDomains is '${auto_assign}', expected 'false'"

echo "current production: ${production_id}"

aliases=$(api_get "/v4/aliases?projectId=${VERCEL_PROJECT_ID}&limit=100&t=$(date +%s%N)")
alias_report=$(printf '%s' "$aliases" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const list=JSON.parse(raw).aliases ?? [];
  for (const entry of list) {
    if (entry.deletedAt) continue;
    process.stdout.write(entry.alias + ' ' + entry.deploymentId + '\n');
  }
});
")

production_aliases=$(printf '%s\n' "$alias_report" | awk -v id="$production_id" '$2 == id {print $1}')
[ -n "$production_aliases" ] || fail "the current production deployment holds no aliases"

stolen=$(printf '%s\n' "$alias_report" | awk -v id="$deployment_id" '$2 == id {print $1}')
[ -z "$stolen" ] || fail "the staged deployment already holds aliases: $(printf '%s' "$stolen" | tr '\n' ' ')"

echo "production aliases: $(printf '%s' "$production_aliases" | tr '\n' ' ')"

# ---------------------------------------------------------------------------
# Promote
# ---------------------------------------------------------------------------

echo "== promoting =="

status=$(api -o /dev/null -w '%{http_code}' -X POST \
  "${VERCEL_API_URL}/v10/projects/${VERCEL_PROJECT_ID}/promote/${deployment_id}?teamId=${VERCEL_TEAM_ID}" \
  -H 'Content-Type: application/json' -d '{}')

[ "$status" = "201" ] || fail "the promote request answered with HTTP ${status}"

echo "the promote request was accepted"

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

echo "== verification =="

sleep 5

project=$(api_get "/v9/projects/${VERCEL_PROJECT_ID}?t=$(date +%s%N)")
new_production=$(printf '%s' "$project" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const p=JSON.parse(raw);
  process.stdout.write(String(p.targets?.production?.id ?? ''));
});
")
[ "$new_production" = "$deployment_id" ] || fail "the production target is '${new_production}', expected '${deployment_id}'"

aliases=$(api_get "/v4/aliases?projectId=${VERCEL_PROJECT_ID}&limit=100&t=$(date +%s%N)")
missing=""
for alias in $production_aliases; do
  owner=$(printf '%s' "$aliases" | node -e "
let raw='';process.stdin.on('data',(c)=>{raw+=c}).on('end',()=>{
  const list=JSON.parse(raw).aliases ?? [];
  const hit=list.find((entry)=>entry.alias===process.argv[1] && !entry.deletedAt);
  process.stdout.write(hit?.deploymentId ?? '');
});
" "$alias")
  [ "$owner" = "$deployment_id" ] || missing="${missing} ${alias}"
done

[ -z "$missing" ] || fail "these production aliases do not serve the new deployment:${missing}"

status=$(curl -sS -o /dev/null -w '%{http_code}' "https://${PRODUCTION_DOMAIN}/")
[ "$status" = "200" ] || fail "https://${PRODUCTION_DOMAIN}/ answered with HTTP ${status}"

echo "production deployment: ${new_production}"
echo "production aliases moved: $(printf '%s' "$production_aliases" | tr '\n' ' ')"
echo "https://${PRODUCTION_DOMAIN}/ -> HTTP ${status}"
echo ""
echo "promotion complete"
echo "rollback: curl -X POST '${VERCEL_API_URL}/v9/projects/${VERCEL_PROJECT_ID}/rollback/${production_id}?teamId=${VERCEL_TEAM_ID}'"
