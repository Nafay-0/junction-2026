#!/usr/bin/env bash
# Start a production Dock for the load tests from the existing build (web/.next; this script never builds).
#   tests-live/load/start-server.sh 4650          seed catalogue, model off, public rate limits OFF (the gate itself)
#   tests-live/load/start-server.sh 4651 limits   same, public rate limits ON (the watcher measurement)
# Run from web/. Prints the PID of the node process that listens on PORT, and writes it to $LOG_DIR/dock-load-PORT.pid.
#
# Isolation: every shared service and paid key from .env.local is overridden with a blank value (" ": Dock's env()
# helper trims it to "unset", and Next keeps a variable the shell already set), so nothing touches the Aiven
# databases, the partner's live API or a model. The live-lookup allowance is raised: on the seed catalogue a
# "live lookup" is an in-memory read, and the default caps (3,000 a day for all agents) would end the run early.
set -euo pipefail
PORT="${1:?port}"
MODE="${2:-nolimits}"
LOG_DIR="${LOG_DIR:-${TMPDIR:-/tmp}}"
LOG="$LOG_DIR/dock-load-$PORT.log"
if lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "port $PORT is in use; not touching it" >&2; exit 1; fi
B=" "
LIMITS=(DOCK_RATE_LIMITS=off)
[ "$MODE" = "limits" ] && LIMITS=()
env -u DOCK_AIVEN \
  DOCK_STORE=memory DOCK_ACTIONS=off DOCK_CACHE=memory DOCK_BUS=memory DOCK_SEARCH=in-process \
  DOCK_CATALOG=seed DOCK_LLM=off DOCK_MEMORY_LLM=off RADAR_POLL=off \
  DATABASE_URL="$B" VALKEY_URL="$B" OPENSEARCH_URL="$B" KAFKA_BOOTSTRAP_SERVERS="$B" DOCK_COPILOT_PG_URL="$B" \
  VALIO_API_KEY="$B" ANTHROPIC_API_KEY="$B" OPENAI_API_KEY="$B" GEMINI_API_KEY="$B" FEATHERLESS_API_KEY="$B" \
  VERDA_API_KEY="$B" EXA_API_KEY="$B" CONTEXT_DEV_API_KEY="$B" AIVEN_API_TOKEN="$B" AIVEN_READONLY_TOKEN="$B" \
  DOCK_LIVE_CALLS_PER_HOUR=100000000 DOCK_LIVE_PRODUCTS_PER_HOUR=100000000 DOCK_LIVE_AGENT_CALLS_PER_HOUR=100000000 \
  DOCK_LIVE_CALLS_PER_DAY=1000000000 DOCK_LIVE_DAILY_CALLS=1000000000 \
  ${LIMITS[@]+"${LIMITS[@]}"} \
  nohup pnpm exec next start -p "$PORT" >"$LOG" 2>&1 &
for _ in $(seq 1 80); do
  PID=$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)
  if [ -n "$PID" ] && curl -fsS -o /dev/null "http://localhost:$PORT/api/v1"; then
    echo "$PID" >"$LOG_DIR/dock-load-$PORT.pid"
    echo "Dock ($MODE) on http://localhost:$PORT  node pid $PID  log $LOG"
    exit 0
  fi
  sleep 0.5
done
echo "Dock did not start on $PORT; see $LOG" >&2
exit 1
