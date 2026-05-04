#!/usr/bin/env bash
# validate-release-tarball.sh — Local simulation of CI pack + validate flow
#
# Usage: bash scripts/validate-release-tarball.sh <package-path>
# Example: bash scripts/validate-release-tarball.sh packages/pi-monorepo-registry
#
# This script mirrors the CI release workflow:
#   1. Packs a tarball using the same tar command as CI
#   2. Validates tarball contents (src/, package.json pi manifest, no node_modules)
#   3. Reports results
#
# No actual GitHub release is created — this is for local testing only.

set -euo pipefail

# --- Argument parsing ---
if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/validate-release-tarball.sh <package-path>"
  echo "Example: bash scripts/validate-release-tarball.sh packages/pi-monorepo-registry"
  exit 1
fi

PKG_PATH="$1"

# Resolve to repo root (this script lives in scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Verify package path exists
if [ ! -f "${REPO_ROOT}/${PKG_PATH}/package.json" ]; then
  echo "❌ FAIL: No package.json found at ${PKG_PATH}/package.json"
  exit 1
fi

cd "$REPO_ROOT"

# --- Read package metadata ---
pkg_name=$(jq -r '.name' "${PKG_PATH}/package.json")
pkg_version=$(jq -r '.version' "${PKG_PATH}/package.json")
tarball="${pkg_name}-${pkg_version}.tgz"

echo "=== Simulating release tarball for: ${pkg_name}@${pkg_version} ==="
echo ""

# --- Step 1: Pack tarball (same as CI) ---
echo "--- Step 1: Packing tarball ---"
tar -czf "$tarball" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.*' \
  -C "$(dirname "${PKG_PATH}")" "$(basename "${PKG_PATH}")"

echo "Created: ${tarball}"
echo "Size: $(ls -lh "$tarball" | awk '{print $5}')"
echo ""

# --- Step 2: Validate tarball contents (same logic as CI Validate step) ---
echo "--- Step 2: Validating tarball contents ---"
validate_dir=$(mktemp -d)
tar -xzf "$tarball" -C "$validate_dir"

# Find the extracted package directory (single top-level dir)
pkg_dir=$(ls "$validate_dir")

errors=0

# Check 1: src/ directory exists
if [ -d "${validate_dir}/${pkg_dir}/src" ]; then
  echo "✅ src/ directory found"
else
  echo "❌ FAIL: src/ directory missing"
  errors=$((errors + 1))
fi

# Check 2: package.json exists and has pi manifest
pj="${validate_dir}/${pkg_dir}/package.json"
if [ -f "$pj" ]; then
  has_pi_ext=$(jq -e '.pi.extensions' "$pj" > /dev/null 2>&1 && echo "yes" || echo "no")
  has_pi_kw=$(jq -e '.keywords | index("pi-package")' "$pj" > /dev/null 2>&1 && echo "yes" || echo "no")
  if [ "$has_pi_ext" = "yes" ] || [ "$has_pi_kw" = "yes" ]; then
    echo "✅ package.json has pi manifest (extensions=$has_pi_ext, keyword=$has_pi_kw)"
  else
    echo "❌ FAIL: package.json missing pi.extensions and pi-package keyword"
    errors=$((errors + 1))
  fi
else
  echo "❌ FAIL: package.json missing"
  errors=$((errors + 1))
fi

# Check 3: No node_modules/ directory
if [ -d "${validate_dir}/${pkg_dir}/node_modules" ]; then
  echo "❌ FAIL: node_modules/ found in tarball"
  errors=$((errors + 1))
else
  echo "✅ No node_modules/ in tarball"
fi

# Summary
echo ""
echo "=== Validation: ${errors} error(s) ==="

# Cleanup
rm -rf "$validate_dir"

if [ "$errors" -gt 0 ]; then
  echo "❌ Validation FAILED with ${errors} error(s)"
  rm -f "$tarball"
  exit 1
fi

echo "Validation passed for ${tarball}"
echo ""
echo "Tarball preserved at: ${tarball}"
echo "(Delete manually when done: rm ${tarball})"
