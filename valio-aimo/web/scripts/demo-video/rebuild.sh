#!/bin/sh
# Bring the capture clone to origin/main (merge, never rebase) and rebuild the production app (the server must be
# stopped first; start it again with scripts/demo-video/serve.sh).
cd "$(dirname "$0")/../.." || exit 1
git fetch -q origin && git merge --no-edit -q origin/main || exit 1
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null 2>&1 || exit 1
rm -rf .next
env DATABASE_URL= OPENSEARCH_URL= VALKEY_URL= KAFKA_BOOTSTRAP_SERVERS= DOCK_PUBLIC_URL= DOCK_MARIADB_URL= \
  DOCK_COPILOT_PG_URL= AIVEN_READONLY_TOKEN= AIVEN_API_TOKEN= AIVEN_PROJECT= AIVEN_ORGANIZATION_ID= DOCK_AIVEN_LAUNCH_TOKEN= \
  pnpm -s build
