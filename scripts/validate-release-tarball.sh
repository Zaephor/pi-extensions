#!/usr/bin/env bash
# validate-release-tarball.sh — Local simulation of CI pack + validate flow.
#
# Usage: bash scripts/validate-release-tarball.sh <package-path>
# Example: bash scripts/validate-release-tarball.sh packages/pi-monorepo-registry
#
# Mirrors the CI release workflow exactly by delegating to the shared
# pack_release_tarball / validate_release_tarball functions in
# scripts/lib/release-tarball.sh. If this script passes locally, the CI
# tarball step will pack identical contents.

set -euo pipefail

if [ $# -lt 1 ]; then
	echo "Usage: bash scripts/validate-release-tarball.sh <package-path>"
	echo "Example: bash scripts/validate-release-tarball.sh packages/pi-monorepo-registry"
	exit 1
fi

PKG_PATH="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ ! -f "${REPO_ROOT}/${PKG_PATH}/package.json" ]; then
	echo "❌ FAIL: No package.json found at ${PKG_PATH}/package.json"
	exit 1
fi

cd "${REPO_ROOT}"

# shellcheck source=lib/release-tarball.sh
source "${SCRIPT_DIR}/lib/release-tarball.sh"

pkg_name=$(jq -r '.name' "${PKG_PATH}/package.json")
pkg_version=$(jq -r '.version' "${PKG_PATH}/package.json")
tarball="${pkg_name}-${pkg_version}.tgz"

echo "=== Simulating release tarball for: ${pkg_name}@${pkg_version} ==="
echo ""

echo "--- Step 1: Packing tarball ---"
pack_release_tarball "${PKG_PATH}" "${tarball}"
echo "Created: ${tarball}"
echo "Size: $(ls -lh "${tarball}" | awk '{print $5}')"
echo ""
echo "--- Tarball contents ---"
tar -tzf "${tarball}"
echo ""

echo "--- Step 2: Validating tarball contents ---"
if validate_release_tarball "${tarball}"; then
	echo ""
	echo "Validation passed for ${tarball}"
	echo ""
	echo "Tarball preserved at: ${tarball}"
	echo "(Delete manually when done: rm ${tarball})"
else
	echo ""
	echo "❌ Validation FAILED"
	rm -f "${tarball}"
	exit 1
fi
