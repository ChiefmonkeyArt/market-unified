#!/usr/bin/env bash
# Usage: scripts/package/make.sh <project_dir> <out_dir>
# Copies every entry in scripts/package/files.txt that exists into <out_dir>.
set -euo pipefail
PROJECT_DIR="$(cd "$1" && pwd)"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"
while IFS= read -r entry; do
	case "$entry" in ''|'#'*) continue ;; esac
	if [ -e "$PROJECT_DIR/$entry" ]; then
		cp -r "$PROJECT_DIR/$entry" "$OUT_DIR/"
	elif [ "$entry" != "dist" ] && [ "$entry" != "public" ]; then
		echo "package: required entry '$entry' missing" >&2
		exit 1
	fi
done < "$PROJECT_DIR/scripts/package/files.txt"
