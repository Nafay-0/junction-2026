#!/usr/bin/env bash
# One command for the whole local check, and a faster one before every deployment. Run from web/.
#
#   tests-live/run.sh full        lint, typecheck, unit tests, build, scripted demos, QA harness, crash test,
#                                 every browser project (6 demo projects, room, a11y, visual, legacy), the model and
#                                 partner failure scenarios, a 2-minute load step. About 35-45 minutes on a laptop.
#   tests-live/run.sh predeploy   typecheck, unit tests, build, pnpm demo, the QA harness's core run, the browser
#                                 demo paths on Chromium phone + WebKit phone. About 8-10 minutes.
#   tests-live/run.sh checks      everything but the browser suite and the load step (the CI "checks" job).
#   tests-live/run.sh ci          full minus the load step.
#
# Every server is hermetic (seed catalogue, no model, no partner, no Aiven, no .env.local) and started on its own
# port (E2E_PORT, default 4601, and +1, +5); nothing touches the public deployment. NO_BUILD=1 reuses .next.
# Prints one PASS/FAIL line per step and exits 1 if any step failed. Logs: test-results/run-<step>.log.
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-predeploy}"
PORT="${E2E_PORT:-4601}"
QA_PORT=$((PORT + 5))
mkdir -p test-results
declare -a RESULTS=()
FAILED=0

step() {
  local name="$1"; shift
  local log="test-results/run-${name}.log"
  local t0=$SECONDS
  if "$@" >"$log" 2>&1; then
    RESULTS+=("PASS  ${name} ($((SECONDS - t0)) s)")
  else
    RESULTS+=("FAIL  ${name} ($((SECONDS - t0)) s)  see ${log}")
    FAILED=1
  fi
  echo "${RESULTS[${#RESULTS[@]}-1]}"
}

QA_PID=""
qa_server() {
  E2E_SERVER_ENV='{"DOCK_RATE_LIMITS":"off"}' node e2e/support/start-server.mjs "$QA_PORT" >test-results/run-qa-server.log 2>&1 &
  QA_PID=$!
  for _ in $(seq 1 120); do curl -fsS -o /dev/null "http://localhost:${QA_PORT}/api/v1" && return 0; sleep 0.5; done
  return 1
}
stop_qa_server() { [ -n "$QA_PID" ] && kill "$QA_PID" 2>/dev/null; QA_PID=""; }
trap stop_qa_server EXIT

with_qa_server() { qa_server && "$@"; local rc=$?; stop_qa_server; return $rc; }

e2e() { PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/results.json pnpm exec playwright test "$@"; }

case "$MODE" in
  predeploy)
    step typecheck pnpm typecheck
    step unit pnpm test
    [ -n "${NO_BUILD:-}" ] || step build pnpm build
    step demo pnpm demo
    step qa with_qa_server pnpm qa --url "http://localhost:${QA_PORT}"
    step browser e2e --project=chromium-phone --project=webkit-phone e2e/demo/approval.spec.ts e2e/demo/store.spec.ts e2e/demo/catalogue.spec.ts e2e/demo/presenter.spec.ts
    ;;
  full | ci | checks)
    step lint pnpm lint
    step typecheck pnpm typecheck
    step unit pnpm test
    [ -n "${NO_BUILD:-}" ] || step build pnpm build
    step demo pnpm demo
    step demo-mcp with_qa_server pnpm demo:mcp --url "http://localhost:${QA_PORT}"
    step demo-all pnpm demo:all --seed
    step crash pnpm crash:reproduce
    step qa with_qa_server pnpm qa --url "http://localhost:${QA_PORT}"
    [ "$MODE" = checks ] || step browser e2e
    step deps pnpm exec tsx tests-live/deps/run.ts --only model,partner
    if [ "$MODE" = full ]; then
      step load pnpm exec tsx tests-live/load/load.ts --fresh-port $((PORT + 6)) --steps 1,4 --step-seconds 60
    fi
    ;;
  *) echo "usage: tests-live/run.sh full|predeploy|ci" >&2; exit 2 ;;
esac

echo
echo "== AimoPilot test run ($MODE), $(git rev-parse --short HEAD 2>/dev/null) =="
printf '%s\n' "${RESULTS[@]}"
[ -f test-results/results.json ] && node e2e/support/summary.mjs
exit $FAILED
