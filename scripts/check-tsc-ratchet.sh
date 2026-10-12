#!/usr/bin/env bash
# Type-check ratchet. The upstream tree carries pre-existing tsc errors, so CI cannot yet
# require zero; it requires the count never goes UP. Lower scripts/tsc-baseline.txt when it drops.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$(head -n1 "$ROOT/scripts/tsc-baseline.txt" | tr -dc '0-9')"
OUT="$(cd "$ROOT" && bunx tsc --noEmit -p . 2>&1)"
CURRENT="$(printf '%s\n' "$OUT" | grep -c 'error TS' || true)"
echo "tsc errors: $CURRENT (baseline: $BASELINE)"
# New code under sdk/ ui/ platform/ must be clean, whatever the global count.
NEW_ZONE="$(printf '%s\n' "$OUT" | grep -E '^(sdk|ui|platform)/.*error TS' || true)"
if [ -n "$NEW_ZONE" ]; then echo "::error::type errors in sdk/ui/platform (must be zero):"; printf '%s\n' "$NEW_ZONE"; exit 1; fi
if [ "$CURRENT" -gt "$BASELINE" ]; then
	echo "::error::tsc error count rose from $BASELINE to $CURRENT"; printf '%s\n' "$OUT" | grep 'error TS' | head -50; exit 1
fi
[ "$CURRENT" -lt "$BASELINE" ] && echo "::notice::tsc errors dropped; lower scripts/tsc-baseline.txt to $CURRENT"
exit 0
