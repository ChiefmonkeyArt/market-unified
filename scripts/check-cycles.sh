#!/usr/bin/env bash
# Runtime import-cycle guard (type-only imports ignored via .madgerc).
# The retrofit measured a 36-file cycle around src/lib/stores/ndk.ts; it is now broken.
# This fails if any of the knot's former core files re-enter a cycle, or if cycles grow.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MAX_FILES_IN_CYCLES="$(head -n1 scripts/cycles-baseline.txt | tr -dc '0-9')"
bunx madge --extensions ts,tsx --ts-config tsconfig.json --json src sdk ui platform contextvm > /tmp/madge-graph.json 2>/dev/null
OUT="$(python3 scripts/scc.py /tmp/madge-graph.json)"
printf '%s\n' "${OUT:-no runtime cycles}"
FILES="$(printf '%s\n' "$OUT" | awk 'NF{s+=$1} END{print s+0}')"
echo "files in runtime cycles: $FILES (baseline: $MAX_FILES_IN_CYCLES)"
for core in src/lib/stores/ndk.ts src/lib/stores/auth.ts src/lib/utils.ts src/lib/nostr/io.ts src/lib/wallet/storage.ts; do
	if printf '%s\n' "$OUT" | grep -q "'$core'"; then echo "::error::$core is back in an import cycle"; exit 1; fi
done
if [ "$FILES" -gt "$MAX_FILES_IN_CYCLES" ]; then echo "::error::runtime cycles grew"; exit 1; fi
