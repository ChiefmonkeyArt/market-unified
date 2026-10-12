#!/usr/bin/env bash
# Deploy-package smoke test.
# Builds a deploy-shaped package in a temp dir (from scripts/package/files.txt), boots the
# production server from inside it against a throwaway local relay, and requires HTTP 200.
# This is the check that would have caught "Could not resolve @platform/web/boot".
# Needs: bun, nak (NAK=/path/to/nak, default "nak").
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAK="${NAK:-nak}"
PORT="${SMOKE_PORT:-3999}"
TMP="$(mktemp -d)"
cleanup() { [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null || true; [ -n "${RLY:-}" ] && kill "$RLY" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

bash "$ROOT/scripts/package/make.sh" "$ROOT" "$TMP/pkg"
ln -s "$ROOT/node_modules" "$TMP/pkg/node_modules"

"$NAK" serve --hostname 127.0.0.1 > "$TMP/relay.log" 2>&1 &
RLY=$!
for _ in $(seq 1 20); do (echo > /dev/tcp/127.0.0.1/10547) 2>/dev/null && break; sleep 0.5; done

export APP_RELAY_URL=ws://127.0.0.1:10547
export APP_PRIVATE_KEY="$(openssl rand -hex 32)"   # ephemeral, never stored
(cd "$ROOT" && bun run scripts/startup.ts > "$TMP/startup.log" 2>&1) || { cat "$TMP/startup.log"; exit 1; }

(cd "$TMP/pkg" && NODE_ENV=production PORT="$PORT" bun src/index.tsx > "$TMP/server.log" 2>&1) &
SRV=$!
code=000
for _ in $(seq 1 60); do
	code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)
	[ "$code" = 200 ] && break
	kill -0 "$SRV" 2>/dev/null || break
	sleep 1
done
if [ "$code" != 200 ]; then
	echo "package smoke: FAILED (HTTP $code)"; tail -40 "$TMP/server.log"; exit 1
fi
html="$(curl -s "http://127.0.0.1:$PORT/")"
assets="$(printf '%s' "$html" | grep -oE '(src|href)="/[^"]+\.(js|css)"' | sed -E 's/^(src|href)="//; s/"$//' || true)"
if [ -z "$assets" ]; then
	echo "package smoke: FAILED (no bundled JS/CSS referenced by /)"; printf '%s\n' "$html" | head -40; tail -40 "$TMP/server.log"; exit 1
fi
for a in $assets; do
	acode=$(curl -s -o "$TMP/asset" -w '%{http_code}' "http://127.0.0.1:$PORT$a")
	if [ "$acode" != 200 ] || grep -q 'Could not resolve' "$TMP/asset"; then
		echo "package smoke: FAILED asset $a (HTTP $acode)"; tail -40 "$TMP/server.log"; exit 1
	fi
done
if grep -qE 'Could not resolve|Cannot find module' "$TMP/server.log"; then
	echo "package smoke: FAILED (unresolved import in server log)"; grep -E 'Could not resolve|Cannot find module' "$TMP/server.log" | head; exit 1
fi
echo "package smoke: OK (packaged server and $(echo "$assets" | wc -w) bundled assets answered HTTP 200)"
