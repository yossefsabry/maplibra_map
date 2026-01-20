#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_SCRIPT="$PROJECT_ROOT/scripts/sync-data-map.sh"
BUILD_SCRIPT="$PROJECT_ROOT/scripts/build-walkable-nodes.js"

if [[ ! -f "$SYNC_SCRIPT" ]]; then
  echo "Missing sync script at $SYNC_SCRIPT" >&2
  exit 1
fi

if [[ ! -f "$BUILD_SCRIPT" ]]; then
  echo "Missing walkable node generator at $BUILD_SCRIPT" >&2
  exit 1
fi

echo "Syncing MVF assets..."
bash "$SYNC_SCRIPT"

if [[ $# -gt 0 ]]; then
  echo "Generating walkable nodes with args: $*"
  node "$BUILD_SCRIPT" "$@"
else
  echo "Generating walkable nodes with defaults: --grid=1 --areas"
  node "$BUILD_SCRIPT" --grid=1 --areas
fi

echo "Done."
