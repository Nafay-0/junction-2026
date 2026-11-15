#!/bin/sh
# The second capture pass (run from valio-aimo/web on a server rebuilt from origin/main): the ordering flow, talking
# it round, the mistake check, the dish flow in the conversation, the wholesaler's Orders page. The first pass's clips
# move to clips/previous/ as they are replaced. Logs to $LOGS (default: the work folder).
#   sh scripts/demo-video/pass2.sh [extra stages for c04, e.g. dish,backup]
cd "$(dirname "$0")/../.." || exit 1
LOGS="${LOGS:-/Users/macbookair/dock-shots/demo-video/.work/pass2-logs}"
mkdir -p "$LOGS"
export KEEP_PREVIOUS=1
URL="${URL:-http://localhost:5142}"
npx tsx scripts/demo-video/c02.ts --url "$URL" > "$LOGS/c02.log" 2>&1; echo "c02 exit $?"
npx tsx scripts/demo-video/c03.ts --url "$URL" --only mistake > "$LOGS/c03.log" 2>&1; echo "c03 exit $?"
npx tsx scripts/demo-video/c04.ts --url "$URL" --only "${1:-dish}" > "$LOGS/c04.log" 2>&1; echo "c04 exit $?"
npx tsx scripts/demo-video/c06.ts --url "$URL" --only orders > "$LOGS/c06.log" 2>&1; echo "c06 exit $?"
npx tsx scripts/demo-video/index.ts
