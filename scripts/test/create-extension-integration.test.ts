/**
 * Integration tests for scripts/create-extension.js — cleanup on failure,
 * directory conflict handling, and end-to-end verification.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const scaffoldScript = resolve(rootDir, "scripts/create-extension.js");
const packagesDir = resolve(rootDir, "packages");
const tsconfigPath = resolve(rootDir, "tsconfig.json");
const manifestPath = resolve(rootDir, ".release-please-manifest.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScaffoldResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Run the scaffold script with the given argument(s) and capture results. */
function execScaffold(...args: string[]): Promise<ScaffoldResult> {
	return new Promise((res) => {
		execFile("node", [scaffoldScript, ...args], { cwd: rootDir }, (error, stdout, stderr) => {
			res({
				exitCode: error ? (error.code ?? 1) : 0,
				stdout: stdout ?? "",
				stderr: stderr ?? "",
			});
		});
	});
}

/** Remove a test extension directory if it exists. */
function cleanupExtension(name: string) {
	const pkgDir = resolve(packagesDir, name);
	if (existsSync(pkgDir)) {
		rmSync(pkgDir, { recursive: true, force: true });
	}
}

/** Run a shell command from rootDir and return exit code + output. */
function execCommand(command: string, timeout = 60_000): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((res) => {
		execFile("sh", ["-c", command], { cwd: rootDir, timeout }, (error, stdout, stderr) => {
			res({
				exitCode: error ? (error.code ?? 1) : 0,
				stdout: stdout ?? "",
				stderr: stderr ?? "",
			});
		});
	});
}

/** Remove all test-* extension directories that match our naming convention. */
function cleanupAllTestExtensions() {
	const entries = existsSync(packagesDir) ? readdirSync(packagesDir) : [];
	for (const entry of entries) {
		if (entry.startsWith("cleanup-") || entry.startsWith("conflict-") || entry.startsWith("e2e-check-")) {
			cleanupExtension(entry);
		}
	}
}

// ---------------------------------------------------------------------------
// Config snapshots
// ---------------------------------------------------------------------------

let originalTsconfig: string;
let originalManifest: string;

beforeAll(() => {
	originalTsconfig = readFileSync(tsconfigPath, "utf-8");
	originalManifest = readFileSync(manifestPath, "utf-8");
});

afterAll(() => {
	// Restore configs
	writeFileSync(tsconfigPath, originalTsconfig);
	writeFileSync(manifestPath, originalManifest);

	// Remove all test extension directories
	cleanupAllTestExtensions();

	// Reset git index only for config files modified by this test
	execFile(
		"git",
		["checkout", "--", "tsconfig.json", ".release-please-manifest.json", "package.json", "package-lock.json"],
		{ cwd: rootDir },
		() => {},
	);
	execFile(
		"git",
		["reset", "HEAD", "tsconfig.json", ".release-please-manifest.json", "package.json", "package-lock.json"],
		{ cwd: rootDir },
		() => {},
	);
});

// ---------------------------------------------------------------------------
// Cleanup on failure
// ---------------------------------------------------------------------------

describe("cleanup on failure", () => {
	const extName = "cleanup-test-ext";

	afterAll(() => {
		cleanupExtension(extName);
	});

	it("removes partial directory when root config is corrupted", async () => {
		// Corrupt tsconfig.json so updateRootTsconfig will throw
		writeFileSync(tsconfigPath, "INVALID JSON{{");

		const result = await execScaffold(extName);

		// Restore tsconfig immediately — don't leave it corrupted for other tests
		writeFileSync(tsconfigPath, originalTsconfig);

		// Script should fail
		expect(result.exitCode).not.toBe(0);

		// Partial directory should be cleaned up by the script's catch block
		expect(existsSync(resolve(packagesDir, extName))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Directory conflict — existing extension not corrupted
// ---------------------------------------------------------------------------

describe("directory conflict handling", () => {
	const extName = "conflict-ext";
	const pkgDir = resolve(packagesDir, extName);

	const expectedFiles = ["package.json", "tsconfig.json", "src/index.ts", "README.md"];

	afterAll(() => {
		// Restore configs — scaffolding updates tsconfig references and release manifest
		writeFileSync(tsconfigPath, originalTsconfig);
		writeFileSync(manifestPath, originalManifest);
		cleanupExtension(extName);
	});

	it("does not corrupt existing extension on duplicate scaffold attempt", async () => {
		// First scaffold should succeed
		const first = await execScaffold(extName);
		expect(first.exitCode).toBe(0);

		// Verify directory exists with expected files
		for (const file of expectedFiles) {
			expect(existsSync(resolve(pkgDir, file)), `Missing file after first scaffold: ${file}`).toBe(true);
		}

		// Snapshot package.json content to compare later
		const originalPkgJson = readFileSync(resolve(pkgDir, "package.json"), "utf-8");

		// Second scaffold should fail because directory already exists
		const second = await execScaffold(extName);
		expect(second.exitCode).toBe(1);
		expect(second.stderr).toContain("already exists");

		// Verify all original files still exist (not corrupted or removed)
		for (const file of expectedFiles) {
			expect(existsSync(resolve(pkgDir, file)), `File missing after conflict: ${file}`).toBe(true);
		}

		// Verify package.json content is unchanged
		const currentPkgJson = readFileSync(resolve(pkgDir, "package.json"), "utf-8");
		expect(currentPkgJson).toBe(originalPkgJson);
	});
});

// ---------------------------------------------------------------------------
// End-to-end verification — scaffolded extension passes full pipeline
// ---------------------------------------------------------------------------

describe("end-to-end verification", () => {
	const extName = "e2e-check-ext";
	const pkgDir = resolve(packagesDir, extName);

	// This test is slow: npm install + typecheck + check + test
	it("scaffolded extension passes install, typecheck, check, and test", async () => {
		// Scaffold the extension
		const scaffoldResult = await execScaffold(extName);
		expect(scaffoldResult.exitCode).toBe(0);
		expect(existsSync(pkgDir)).toBe(true);

		// npm install — resolve new workspace dependency
		const installResult = await execCommand("npm install", 120_000);
		expect(installResult.exitCode).toBe(0);

		// npm run typecheck — verify TypeScript compiles cleanly
		const typecheckResult = await execCommand("npm run typecheck", 120_000);
		expect(typecheckResult.exitCode).toBe(0);

		// biome check on the new package only (root check has pre-existing issues)
		const checkResult = await execCommand(`npx biome check packages/${extName}`, 60_000);
		expect(checkResult.exitCode).toBe(0);

		// Run vitest on only the scaffolded extension's tests (not full npm test
		// which would recursively include this integration test)
		const testResult = await execCommand(`npx vitest run packages/${extName}`, 120_000);
		expect(testResult.exitCode).toBe(0);

		// Clean up: remove extension dir, restore configs
		cleanupExtension(extName);
		writeFileSync(tsconfigPath, originalTsconfig);
		writeFileSync(manifestPath, originalManifest);

		// npm install again to update lockfile after cleanup
		const reinstallResult = await execCommand("npm install", 120_000);
		expect(reinstallResult.exitCode).toBe(0);

		// Reset git index only for config files modified by this test
		await execCommand("git checkout -- tsconfig.json .release-please-manifest.json package.json package-lock.json");
		await execCommand("git reset HEAD tsconfig.json .release-please-manifest.json package.json package-lock.json");
	}, 180_000);
});
