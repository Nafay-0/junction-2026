#!/bin/sh
# The local production server the demo video is recorded against (run from valio-aimo/web, after `pnpm build`).
#   sh scripts/demo-video/serve.sh            # port 5142, clock starting at Sunday 15 Nov 10:30 Helsinki
#   PORT=5143 FAKE_NOW= sh scripts/demo-video/serve.sh   # real clock
# Every hosted service is blanked: nothing here talks to a hosted database, search or stream; only the model
# providers and the partner's mock price API. Sample activity stays on (the default locally).
cd "$(dirname "$0")/../.." || exit 1
FAKE_NOW="${FAKE_NOW-2026-11-15T10:30:00+02:00}"
PRELOAD=""
[ -n "$FAKE_NOW" ] && PRELOAD="--require $(pwd)/scripts/demo-video/fake-now.cjs"
exec env DATABASE_URL= OPENSEARCH_URL= VALKEY_URL= KAFKA_BOOTSTRAP_SERVERS= DOCK_PUBLIC_URL= DOCK_MARIADB_URL= \
  DOCK_COPILOT_PG_URL= AIVEN_READONLY_TOKEN= AIVEN_API_TOKEN= AIVEN_PROJECT= AIVEN_ORGANIZATION_ID= DOCK_AIVEN_LAUNCH_TOKEN= \
  DOCK_OPS_PASSCODE=capture-ops DOCK_LLM_DAILY_USD=40 DOCK_LLM_DAILY_CALLS=4000 \
  DOCK_FAKE_NOW="$FAKE_NOW" NODE_OPTIONS="$PRELOAD" PORT="${PORT:-5142}" \
  pnpm -s start
