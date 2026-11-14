#!/usr/bin/env bash
# Delete ONLY the paid Aiven resources the aiven-infra work created. Free services are left alone.
#
#   infra/aiven-teardown.sh            show what would be deleted (dry run)
#   infra/aiven-teardown.sh --yes      delete
#
# Deletes: services dock-app (Runtime, paid) and dock-grafana (paid); the read-only application user
# dock-grafana-reader (and with it its token). Leaves dock-pg, dock-search, dock-cache, dock-events
# (free, created by the team) untouched, including the grafana_reader role and telemetry schema in
# dock-pg. Also prints the GitHub deploy-key command to run by hand.
# Reads AIVEN_API_TOKEN, AIVEN_PROJECT and AIVEN_ORGANIZATION_ID from web/.env.local or the environment.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
env_file="$here/../web/.env.local"
get() { # read KEY from the environment, else from web/.env.local, without echoing it
  local v="${!1:-}"
  if [[ -z "$v" && -f "$env_file" ]]; then v="$(grep -E "^$1=" "$env_file" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"; fi
  printf '%s' "$v"
}
TOKEN="$(get AIVEN_API_TOKEN)"; PROJECT="$(get AIVEN_PROJECT)"; ORG="$(get AIVEN_ORGANIZATION_ID)"
[[ -n "$TOKEN" && -n "$PROJECT" && -n "$ORG" ]] || { echo "need AIVEN_API_TOKEN, AIVEN_PROJECT, AIVEN_ORGANIZATION_ID" >&2; exit 1; }

PAID_SERVICES=(dock-app dock-grafana)
APP_USER_NAME="dock-grafana-reader"
DRY=1; [[ "${1:-}" == "--yes" ]] && DRY=0

api() { curl -sS -H "Authorization: aivenv1 $TOKEN" -H 'Content-Type: application/json' "$@"; }
base="https://api.aiven.io/v1"

for s in "${PAID_SERVICES[@]}"; do
  plan="$(api "$base/project/$PROJECT/service/$s" | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("service"); print(s["plan"] if s else "absent")')"
  if [[ "$plan" == "absent" ]]; then echo "service $s: not found, skipping"; continue; fi
  if [[ "$plan" == free-* ]]; then echo "service $s: on a free plan ($plan), refusing to delete"; continue; fi
  if (( DRY )); then echo "would delete service $s ($plan)"; else
    api -X DELETE "$base/project/$PROJECT/service/$s" -o /dev/null -w "deleted service $s ($plan): HTTP %{http_code}\n"
  fi
done

uid="$(api "$base/organization/$ORG/application-users" | python3 -c "
import json,sys
for u in json.load(sys.stdin).get('application_users', []):
    if u.get('name') == '$APP_USER_NAME': print(u['user_id'])")"
if [[ -z "$uid" ]]; then echo "application user $APP_USER_NAME: not found, skipping"
elif (( DRY )); then echo "would delete application user $APP_USER_NAME ($uid) and its tokens"
else api -X DELETE "$base/organization/$ORG/application-users/$uid" -o /dev/null -w "deleted application user $APP_USER_NAME: HTTP %{http_code}\n"; fi

echo
echo "By hand, if Aiven Runtime is no longer needed: remove the read-only deploy key from GitHub:"
echo "  gh repo deploy-key list --repo Nafay-0/junction-2026   # 'Aiven Runtime dock-app (read-only)'"
echo "  gh repo deploy-key delete <id> --repo Nafay-0/junction-2026"
(( DRY )) && echo && echo "dry run: nothing deleted. Re-run with --yes to delete."
exit 0
