/**
 * Git integration tests — validate the root causes of the stale version bug
 * and confirm the fixes work end-to-end.
 *
 * Three categories, all using temp directories only:
 *
 *   1. Self-URL detection (THE CORE BUG):
 *      - normalizeGitUrl now normalizes SSH↔HTTPS so isSelfUrl matches
 *      - Tests against the real workspace git remote
 *
 *   2. Symlink resolution:
 *      - getExtensionMonorepoRoot and resolveSourceRoot now use realpathSync
 *      - Tests that symlinked local paths resolve to the real directory
 *
 *   3. Discovery freshness:
 *      - Verifies discoverPackages always reads from disk (no caching)
 *      - Simulates the version bump scenario (0.2.2 → 0.2.6)
 */

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPackages } from "../src/discovery.js";
import { getExtensionMonorepoRoot, isSelfUrl, normalizeGitUrl, resolveSourceRoot } from "../src/git.js";

// --------------- Helpers ---------------

function createTempDir(label: string): string {
	const dir = join(tmpdir(), `pi-git-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function addPackage(monorepoRoot: string, packagesRoot: string, name: string, version: string): string {
	const packagesDir = join(monorepoRoot, packagesRoot);
	const pkgDir = join(packagesDir, name);
	mkdirSync(pkgDir, { recursive: true });
	writeFileSync(
		join(pkgDir, "package.json"),
		JSON.stringify({ name, version, pi: { extensions: ["./src/index.ts"] } }, null, "\t"),
	);
	mkdirSync(join(pkgDir, "src"), { recursive: true });
	writeFileSync(join(pkgDir, "src", "index.ts"), "export default async function() {}");
	return pkgDir;
}

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
});

// =====================================================================
// CATEGORY 1: Self-URL detection — the core bug fix
// =====================================================================
// Before the fix: normalizeGitUrl("git@github.com:owner/repo") returned
//   "git@github.com:owner/repo" while normalizeGitUrl("https://github.com/owner/repo")
//   returned "https://github.com/owner/repo" — they never compared equal.
// After the fix: both normalize to "https://github.com/owner/repo".
// This means isSelfUrl correctly identifies the local checkout regardless of
// whether the user registered the source with SSH or HTTPS format.
// =====================================================================

describe("BUG FIX: isSelfUrl detects self across SSH/HTTPS format mismatch", () => {
	it("matches the real workspace remote in its native format", () => {
		const monorepoRoot = getExtensionMonorepoRoot();
		let remoteUrl: string;
		try {
			remoteUrl = execSync("git remote get-url origin", { cwd: monorepoRoot, encoding: "utf-8" }).trim();
		} catch {
			return; // No remote — skip
		}
		expect(isSelfUrl(remoteUrl)).toBe(true);
	});

	it("matches when source URL is HTTPS but remote is SSH (or vice versa)", () => {
		const monorepoRoot = getExtensionMonorepoRoot();
		let remoteUrl: string;
		try {
			remoteUrl = execSync("git remote get-url origin", { cwd: monorepoRoot, encoding: "utf-8" }).trim();
		} catch {
			return;
		}

		let alternateUrl: string;
		if (remoteUrl.startsWith("git@")) {
			const match = remoteUrl.match(/^git@([^:]+):(.+)$/);
			if (!match) return;
			alternateUrl = `https://${match[1]}/${match[2]}`;
		} else if (remoteUrl.startsWith("https://")) {
			const match = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+)$/);
			if (!match) return;
			alternateUrl = `git@${match[1]}:${match[2]}`;
		} else {
			return;
		}

		expect(isSelfUrl(alternateUrl)).toBe(true);
	});

	it("rejects unrelated repos", () => {
		expect(isSelfUrl("https://github.com/definitely/not-this-repo.git")).toBe(false);
		expect(isSelfUrl("git@github.com:Zaephor/some-other-repo.git")).toBe(false);
	});
});

describe("normalizeGitUrl: all SSH and HTTPS variants collapse to a single form", () => {
	it("normalizes four variant URLs to one canonical form", () => {
		const variants = [
			"git@github.com:Zaephor/pi-extensions.git",
			"git@github.com:Zaephor/pi-extensions",
			"https://github.com/Zaephor/pi-extensions.git",
			"https://github.com/Zaephor/pi-extensions",
		];
		const normalized = variants.map(normalizeGitUrl);
		expect(new Set(normalized).size).toBe(1);
		expect(normalized[0]).toBe("https://github.com/Zaephor/pi-extensions");
	});
});

// =====================================================================
// CATEGORY 2: Symlink resolution — prevents wrong monorepo root
// =====================================================================
// Before the fix: getExtensionMonorepoRoot returned the raw path from
//   import.meta.url, which could be a symlink path when installed in dev mode.
//   This caused isSelfUrl to run `git remote get-url origin` in the wrong
//   directory, failing to detect the self-URL.
// After the fix: realpathSync resolves through symlinks to the real path.
// =====================================================================

describe("resolveSourceRoot: symlink resolution for local paths", () => {
	it("follows symlinks to the real directory for package discovery", async () => {
		const realDir = createTempDir("real");
		tempDirs.push(realDir);
		addPackage(realDir, "packages", "symlinked-pkg", "3.0.0");

		const linkParent = createTempDir("link-parent");
		tempDirs.push(linkParent);
		const symlinkPath = join(linkParent, "link-to-real");
		symlinkSync(realDir, symlinkPath);

		const result = resolveSourceRoot(symlinkPath);
		expect(result.rootPath).toBe(realDir);
		expect(result.cloned).toBe(false);

		const packages = await discoverPackages(result.rootPath, "packages");
		expect(packages).toHaveLength(1);
		expect(packages[0].version).toBe("3.0.0");
	});
});

// =====================================================================
// CATEGORY 3: Discovery freshness — the version update scenario
// =====================================================================
// Validates that discoverPackages always reads from disk (no caching)
// and updateSource reflects version bumps correctly.
// =====================================================================

describe("version refresh: package.json changes on disk are picked up", () => {
	it("updateSource reflects a version bump from 0.2.2 to 0.2.6", async () => {
		const { MonorepoRegistry } = await import("../src/registry.js");
		type RegistryState = { sources: any[]; installedPackages: any[] };

		const fixtureDir = createTempDir("version-bump");
		tempDirs.push(fixtureDir);
		addPackage(fixtureDir, "packages", "pi-monorepo-registry", "0.2.2");

		const state: RegistryState = { sources: [], installedPackages: [] };
		const registry = new MonorepoRegistry(state as any);

		// Initial add sees 0.2.2
		const { source: added } = await registry.addSource(fixtureDir, "packages");
		expect(added.packages[0].version).toBe("0.2.2");

		// Simulate updating the package on disk to 0.2.6
		const pkgJsonPath = join(fixtureDir, "packages", "pi-monorepo-registry", "package.json");
		writeFileSync(
			pkgJsonPath,
			JSON.stringify(
				{
					name: "pi-monorego-registry",
					version: "0.2.6",
					description: "Registry",
					pi: { extensions: ["./src/index.ts"] },
				},
				null,
				"\t",
			),
		);

		// Verify file was written
		const readBack = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		expect(readBack.version).toBe("0.2.6");

		// discoverPackages must read from disk — no stale cache
		const fresh = await discoverPackages(fixtureDir, "packages");
		expect(fresh[0].version).toBe("0.2.6");

		// updateSource must reflect the change
		const { updated } = await registry.updateSource(fixtureDir);
		expect(updated[0].packages[0].version).toBe("0.2.6");

		// Registry state must be updated
		expect(registry.getSources()[0].packages[0].version).toBe("0.2.6");
	});
});
