#!/usr/bin/env bash
# release-tarball.sh — Shared pack + validate logic for release tarballs.
#
# Sourced by both scripts/validate-release-tarball.sh (local) and
# .github/workflows/release.yml (CI) so packing and validation stay in sync.
#
# Functions:
#   pack_release_tarball <pkg-path> <out-tarball>
#       Stage files using package.json "files" allowlist + essential root
#       files (package.json, README.md, LICENSE, CHANGELOG.md). Write tarball
#       containing a single top-level directory named after the package path.
#
#   validate_release_tarball <tarball>
#       Extract tarball to a temp dir and assert: src/ present, package.json
#       has pi.extensions or pi-package keyword, no node_modules/dist/test,
#       no .tsbuildinfo, no nested .tgz. Echoes results. Returns nonzero
#       and prints the error count when any check fails.
#
# Requires: jq, tar, find.

# --- Pack -------------------------------------------------------------------

pack_release_tarball() {
	local pkg_path="$1"
	local out_tarball="$2"

	if [ ! -f "${pkg_path}/package.json" ]; then
		echo "❌ pack_release_tarball: no package.json at ${pkg_path}/package.json" >&2
		return 1
	fi
	if [ -z "${out_tarball}" ]; then
		echo "❌ pack_release_tarball: missing out-tarball arg" >&2
		return 1
	fi

	local staging
	staging=$(mktemp -d)
	local pkg_dst="${staging}/$(basename "${pkg_path}")"
	mkdir -p "${pkg_dst}"

	# Essential root files — always copy when present.
	local f
	for f in package.json README.md LICENSE CHANGELOG.md; do
		[ -f "${pkg_path}/${f}" ] && cp "${pkg_path}/${f}" "${pkg_dst}/${f}"
	done

	# Files allowlist from package.json — directories or individual files.
	local entry
	while IFS= read -r entry; do
		[ -z "${entry}" ] && continue
		if [ -d "${pkg_path}/${entry}" ]; then
			cp -r "${pkg_path}/${entry}" "${pkg_dst}/${entry}"
		elif [ -f "${pkg_path}/${entry}" ]; then
			cp "${pkg_path}/${entry}" "${pkg_dst}/${entry}"
		fi
	done < <(jq -r '(.files // []) | .[]' "${pkg_path}/package.json")

	tar -czf "${out_tarball}" -C "${staging}" "$(basename "${pkg_path}")"
	rm -rf "${staging}"
}

# --- Validate ---------------------------------------------------------------

validate_release_tarball() {
	local tarball="$1"
	if [ ! -f "${tarball}" ]; then
		echo "❌ validate_release_tarball: tarball not found: ${tarball}" >&2
		return 1
	fi

	local validate_dir
	validate_dir=$(mktemp -d)
	tar -xzf "${tarball}" -C "${validate_dir}"

	local pkg_dir
	pkg_dir=$(ls "${validate_dir}")
	local root="${validate_dir}/${pkg_dir}"

	local errors=0

	# 1. src/ directory
	if [ -d "${root}/src" ]; then
		echo "✅ src/ directory found"
	else
		echo "❌ FAIL: src/ directory missing"
		errors=$((errors + 1))
	fi

	# 2. package.json with pi manifest (pi.extensions or pi-package keyword)
	local pj="${root}/package.json"
	if [ -f "${pj}" ]; then
		local has_pi_ext has_pi_kw
		has_pi_ext=$(jq -e '.pi.extensions' "${pj}" > /dev/null 2>&1 && echo "yes" || echo "no")
		has_pi_kw=$(jq -e '.keywords | index("pi-package")' "${pj}" > /dev/null 2>&1 && echo "yes" || echo "no")
		if [ "${has_pi_ext}" = "yes" ] || [ "${has_pi_kw}" = "yes" ]; then
			echo "✅ package.json has pi manifest (extensions=${has_pi_ext}, keyword=${has_pi_kw})"
		else
			echo "❌ FAIL: package.json missing pi.extensions and pi-package keyword"
			errors=$((errors + 1))
		fi
	else
		echo "❌ FAIL: package.json missing"
		errors=$((errors + 1))
	fi

	# 3. No node_modules/
	if [ -d "${root}/node_modules" ]; then
		echo "❌ FAIL: node_modules/ found in tarball"
		errors=$((errors + 1))
	else
		echo "✅ No node_modules/ in tarball"
	fi

	# 4. No dist/
	if [ -d "${root}/dist" ]; then
		echo "❌ FAIL: dist/ found in tarball — only src/ should be shipped"
		errors=$((errors + 1))
	else
		echo "✅ No dist/ in tarball"
	fi

	# 5. No test/
	if [ -d "${root}/test" ]; then
		echo "❌ FAIL: test/ found in tarball — tests should not ship"
		errors=$((errors + 1))
	else
		echo "✅ No test/ in tarball"
	fi

	# 6. No .tsbuildinfo
	if find "${root}" -name '*.tsbuildinfo' | grep -q .; then
		echo "❌ FAIL: .tsbuildinfo found in tarball"
		errors=$((errors + 1))
	else
		echo "✅ No .tsbuildinfo in tarball"
	fi

	# 7. No nested .tgz
	if find "${root}" -name '*.tgz' | grep -q .; then
		echo "❌ FAIL: nested .tgz found in tarball"
		errors=$((errors + 1))
	else
		echo "✅ No nested .tgz in tarball"
	fi

	rm -rf "${validate_dir}"

	if [ "${errors}" -gt 0 ]; then
		echo "::error::Tarball validation failed with ${errors} error(s)"
		return 1
	fi
	return 0
}
