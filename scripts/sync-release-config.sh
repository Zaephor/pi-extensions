#!/usr/bin/env bash
# Sync release-please-config.json packages section with discovered packages.
# Exits 0 if in sync, exits 1 with diff if changes were needed.
# Usage: scripts/sync-release-config.sh [--check]
#   --check: exit 1 if out of sync, don't modify files

set -euo pipefail

CHECK_MODE=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_MODE=true
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/release-please-config.json"
MANIFEST_FILE="$REPO_ROOT/.release-please-manifest.json"

# Discover packages: dirs under packages/ with package.json + src/
DISCOVERED=$(
  for d in "$REPO_ROOT"/packages/*/; do
    [ -f "$d/package.json" ] && [ -d "$d/src" ] || continue
    basename "$d"
  done | sort
)

if [ -z "$DISCOVERED" ]; then
  echo "No packages discovered."
  exit 0
fi

# Build expected packages section from discovered packages (sorted keys)
EXPECTED=$(
  echo "$DISCOVERED" | jq -R -s '
    split("\n") | map(select(length > 0)) | sort
    | map({ key: "packages/\(.)", value: { "release-type": "node", "changelog-type": "default" } })
    | from_entries
  '
)

# Extract current packages from config (re-sorted for comparison)
CURRENT=$(jq -S '.packages' "$CONFIG_FILE")

# Compare sorted JSON
EXPECTED_SORTED=$(echo "$EXPECTED" | jq -S .)
CURRENT_SORTED=$(echo "$CURRENT" | jq -S .)

if [ "$EXPECTED_SORTED" = "$CURRENT_SORTED" ]; then
  echo "✅ release-please-config.json packages section is in sync."
else
  echo "❌ release-please-config.json packages section is OUT OF SYNC."
  echo ""
  echo "Expected packages:"
  echo "$EXPECTED_SORTED" | jq -r 'keys[]' | sed 's/^/  /'
  echo ""
  echo "Current packages:"
  echo "$CURRENT_SORTED" | jq -r 'keys[]' | sed 's/^/  /'
  echo ""

  if [ "$CHECK_MODE" = true ]; then
    echo "Run: npm run sync-release-config"
    exit 1
  fi

  # Sync: merge expected packages into config, preserving non-package fields
  jq --tab --argjson pkgs "$EXPECTED" '.packages = $pkgs' "$CONFIG_FILE" > "$CONFIG_FILE.tmp"
  mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
  echo "✅ Synced release-please-config.json"

  # Also seed manifest entries for any new packages
  MANIFEST=$(cat "$MANIFEST_FILE")
  CHANGED=false
  while IFS= read -r pkg; do
    [ -z "$pkg" ] && continue
    pkg_path="packages/$pkg"
    if echo "$MANIFEST" | jq -e --arg p "$pkg_path" 'has($p)' > /dev/null 2>&1; then
      continue
    fi
    MANIFEST=$(echo "$MANIFEST" | jq --arg p "$pkg_path" --arg v "0.0.0" '. + {($p): $v}')
    echo "  Added manifest entry: $pkg_path -> 0.0.0"
    CHANGED=true
  done <<< "$DISCOVERED"

  if [ "$CHANGED" = true ]; then
    echo "$MANIFEST" > "$MANIFEST_FILE"
    echo "✅ Synced .release-please-manifest.json"
  fi
fi
