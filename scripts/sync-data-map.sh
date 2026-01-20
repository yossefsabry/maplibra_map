#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST_DIR="${MVF_DST_DIR:-"$PROJECT_ROOT/assets"}"

if [[ -n "${MVF_SRC_DIR:-}" ]]; then
  SRC_DIR="$MVF_SRC_DIR"
else
  if [[ -d "$PROJECT_ROOT/temp_mvf" ]]; then
    SRC_DIR="$PROJECT_ROOT/temp_mvf"
  elif [[ -d "$PROJECT_ROOT/data_map" ]]; then
    SRC_DIR="$PROJECT_ROOT/data_map"
  elif [[ -d "$PROJECT_ROOT/../data_map" ]]; then
    SRC_DIR="$PROJECT_ROOT/../data_map"
  else
    SRC_DIR="$PROJECT_ROOT/temp_mvf"
  fi
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "Missing MVF source directory at $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$DST_DIR"

# Sync raw MVF content (keep derived node geojsons already in assets)
rsync -a --exclude 'temp_mvf' "$SRC_DIR"/ "$DST_DIR"/

# Rebuild the MVF bundle zip from the source directory
(
  cd "$SRC_DIR"
  zip -qr "$DST_DIR/my_data.zip" .
)

echo "Synced MVF -> $DST_DIR and rebuilt my_data.zip"
