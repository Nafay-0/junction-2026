#!/usr/bin/env bash
# Start (or restart) a production AimoPilot on PORT for the QA harness, on the seed catalogue unless CATALOG=real.
# Usage: qa/bin/fresh-server.sh 4312 [real]     (run from web/, after `pnpm build`)
set -euo pipefail
PORT="${1:-4311}"
MODE="${2:-seed}"
LOG="${QA_LOG_DIR:-${TMPDIR:-/tmp}}/dock-qa-${PORT}.log"
for pid in $(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
for _ in $(seq 1 20); do lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done
if [ "$MODE" = "real" ]; then
  env -u DOCK_AIVEN nohup pnpm start -p "$PORT" >"$LOG" 2>&1 &
else
  env -u DOCK_AIVEN DOCK_CATALOG=seed nohup pnpm start -p "$PORT" >"$LOG" 2>&1 &
fi
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://localhost:$PORT/api/v1"; then echo "AimoPilot ($MODE) on http://localhost:$PORT, log $LOG"; exit 0; fi
  sleep 0.5
done
echo "AimoPilot did not start on $PORT; see $LOG" >&2
exit 1
