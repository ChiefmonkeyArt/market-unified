#!/usr/bin/env bash
# Run the Playwright e2e suite locally with the same services CI uses:
# a nak relay (:10547), a nutshell FakeWallet Cashu mint (:3338), the seeded
# relay and the dev server (:34567). Everything is torn down on exit.
#
# Usage:
#   NAK=/path/to/nak CASHU_PYTHON_BIN=/path/to/venv/bin bash scripts/e2e/run-local.sh [playwright args...]
#   bash scripts/e2e/run-local.sh --grep 'Multi-Merchant Cart'
#
# With no args it runs the full suite (the CI `e2e-full` job).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

NAK="${NAK:-nak}"
LOG_DIR="${E2E_LOG_DIR:-/tmp/e2e-local}"
mkdir -p "$LOG_DIR"
if [ -n "${CASHU_PYTHON_BIN:-}" ]; then export PATH="$CASHU_PYTHON_BIN:$PATH"; fi

pids=()
cleanup() {
	for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
	wait 2>/dev/null || true
}
trap cleanup EXIT

wait_for() { # name, check-command, tries
	for _ in $(seq 1 "$3"); do
		if eval "$2" >/dev/null 2>&1; then echo "$1 ready"; return 0; fi
		sleep 1
	done
	echo "::error::$1 failed to start (logs in $LOG_DIR)" >&2
	return 1
}

export NODE_ENV=test PORT=34567 APP_RELAY_URL=ws://localhost:10547 LOCAL_RELAY_ONLY=true \
	APP_PRIVATE_KEY=e2e0000000000000000000000000000000000000000000000000000000000001 \
	CVM_SERVER_KEY=e2e2222222222222222222222222222222222222222222222222222222222222 \
	APP_DEV_TEST_MINT_URL=http://localhost:3338 NIP46_RELAY_URL=ws://localhost:10547

"$NAK" serve --hostname 0.0.0.0 >"$LOG_DIR/relay.log" 2>&1 &
pids+=($!)
wait_for relay "(echo > /dev/tcp/localhost/10547)" 15

rm -rf "${CASHU_MINT_DIR:-/tmp/cashu-mint-e2e}"
bash e2e/start-local-mint.sh >"$LOG_DIR/mint.log" 2>&1 &
pids+=($!)
wait_for mint "curl -sf http://localhost:3338/v1/info" 30

bun run generate-routes >"$LOG_DIR/routes.log" 2>&1
# Keep the committed (Prettier-formatted) route tree byte-identical.
bunx prettier --write src/routeTree.gen.ts >>"$LOG_DIR/routes.log" 2>&1
bun e2e/seed-relay.ts >"$LOG_DIR/seed.log" 2>&1
bun dev >"$LOG_DIR/devserver.log" 2>&1 &
pids+=($!)
wait_for "dev server" "curl -sf http://localhost:34567/api/config" 60

# CI=true: use the services started above (the config's webServer block is for ad-hoc runs).
CI=true NODE_OPTIONS='--dns-result-order=ipv4first' bunx playwright test --config=e2e/playwright.config.ts "$@"
