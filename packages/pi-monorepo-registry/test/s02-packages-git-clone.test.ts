/**
 * S02 T02b: PackageManager.installGit happy path against a real git remote.
 *
 * Existing s02-packages.test.ts hands installGit a pre-staged local directory
 * as `sourceUrl`. That short-circuits resolveSourceRoot's clone branch — the
 * actual `git clone` codepath is never exercised by the PackageManager tests.
 *
 * This file fills that gap by:
 *   1. Initializing a bare git repository in temp,
 *   2. Pushing a fixture monorepo to it,
 *   3. Pointing installGit at `file://<bare>` (a real git remote URL),
 *   4. Asserting the clone landed in the configured gitDir, the symlink was
 *      created in extensionsDir, and registry state was updated correctly,
 *   5. Asserting re-install with the same repo hits the existing-clone update
 *      branch in resolveSourceRoot (fetch + reset).
 */
import { execSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACKAGE_ENTRY_TYPES, PackageManager } from "../src/packages.js";
import { getGitDir, resetRegistryBaseDir } from "../src/paths.js";
import type { RegistryState } from "../src/types.js";

let tempDir: string;
let extensionsDir: string;
let gitDir: string;
let settingsFilePath: string;
let bareRepoUrl: string;
let bareRepoPath: string;

function gitIn(dir: string, cmd: string): string {
	return execSync(cmd, { cwd: dir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function addPkg(repoRoot: string, dirName: string, pkgName: string, version: string): void {
	const pkgDir = join(repoRoot, "packages", dirName);
	mkdirSync(join(pkgDir, "src"), { recursive: true });
	writeFileSync(
		join(pkgDir, "package.json"),
		JSON.stringify({ name: pkgName, version, pi: { extensions: ["./src/index.ts"] } }),
	);
	writeFileSync(join(pkgDir, "src", "index.ts"), "export default function () {}\n");
}

beforeEach(() => {
	tempDir = join(tmpdir(), `installgit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	extensionsDir = join(tempDir, "extensions");
	settingsFilePath = join(tempDir, "agent", "settings.json");
	mkdirSync(extensionsDir, { recursive: true });
	mkdirSync(join(tempDir, "agent"), { recursive: true });

	// resolveSourceRoot uses getGitDir() from paths.ts — that resolves via
	// getAgentDir() which honours PI_CODING_AGENT_DIR / GSD_CODING_AGENT_DIR.
	// Point it at the test temp so the clone lands somewhere we can inspect.
	const agentDir = join(tempDir, ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.GSD_CODING_AGENT_DIR = agentDir;
	resetRegistryBaseDir();
	gitDir = getGitDir();
	mkdirSync(gitDir, { recursive: true });

	// Build a bare repo + an upstream working tree to push from.
	bareRepoPath = join(tempDir, "bare.git");
	gitIn(tempDir, `git init --bare "${bareRepoPath}"`);
	bareRepoUrl = `file://${bareRepoPath}`;

	const upstream = join(tempDir, "upstream");
	mkdirSync(upstream, { recursive: true });
	gitIn(upstream, `git clone "${bareRepoUrl}" .`);
	gitIn(upstream, 'git config user.email "t@t.com"');
	gitIn(upstream, 'git config user.name "T"');

	addPkg(upstream, "my-ext", "my-ext", "1.0.0");
	gitIn(upstream, "git add -A");
	gitIn(upstream, 'git commit -m "v1.0.0"');
	gitIn(upstream, "git branch -M main");
	gitIn(upstream, "git push -u origin main");
	gitIn(bareRepoPath, "git symbolic-ref HEAD refs/heads/main");
});

afterEach(() => {
	delete process.env.PI_CODING_AGENT_DIR;
	delete process.env.GSD_CODING_AGENT_DIR;
	resetRegistryBaseDir();
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("PackageManager.installGit — real clone via file:// URL", () => {
	it("clones the source into gitDir on first install and creates a symlink", async () => {
		const state: RegistryState = { sources: [], installedPackages: [] };
		const mgr = new PackageManager(state);

		const events = await mgr.installGit("my-ext", bareRepoUrl, {
			sourceUrl: bareRepoUrl,
			settingsFilePath,
			extensionsDir,
			gitDir,
			packagesRoot: "packages",
		});

		// gitDir should contain exactly one clone dir
		const cloned = readdirSync(gitDir);
		expect(cloned).toHaveLength(1);
		const clonePath = join(gitDir, cloned[0]);
		expect(existsSync(join(clonePath, ".git"))).toBe(true);

		// The cloned content should be the fixture
		const clonedPkgJson = JSON.parse(readFileSync(join(clonePath, "packages", "my-ext", "package.json"), "utf-8"));
		expect(clonedPkgJson.version).toBe("1.0.0");

		// Symlink in extensionsDir → package dir in clone
		const linkPath = join(extensionsDir, "my-ext");
		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

		// State + event
		expect(state.installedPackages).toHaveLength(1);
		expect(state.installedPackages[0].activationMode).toBe("git");
		expect(state.installedPackages[0].sourceUrl).toBe(bareRepoUrl);
		expect(state.installedPackages[0].targetPath).toBe(join(clonePath, "packages", "my-ext"));
		expect(events[0].type).toBe(PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED);
		expect(events[0].data.activationMode).toBe("git");

		// Settings registration
		const settings = JSON.parse(readFileSync(settingsFilePath, "utf-8"));
		expect(settings.extensions).toContain(extensionsDir);
	});

	it("picks up upstream changes on a fresh install when an old clone exists in gitDir", async () => {
		// First install — clones at v1.0.0
		const state1: RegistryState = { sources: [], installedPackages: [] };
		const mgr1 = new PackageManager(state1);
		await mgr1.installGit("my-ext", bareRepoUrl, {
			sourceUrl: bareRepoUrl,
			settingsFilePath,
			extensionsDir,
			gitDir,
			packagesRoot: "packages",
		});
		await mgr1.remove("my-ext", { settingsFilePath, extensionsDir });

		// Push v2.0.0 upstream
		const upstream = join(tempDir, "upstream");
		writeFileSync(
			join(upstream, "packages", "my-ext", "package.json"),
			JSON.stringify({ name: "my-ext", version: "2.0.0", pi: { extensions: ["./src/index.ts"] } }),
		);
		gitIn(upstream, "git add -A");
		gitIn(upstream, 'git commit -m "v2.0.0"');
		gitIn(upstream, "git push");

		// Second install — must exercise the "existing clone" update branch
		const state2: RegistryState = { sources: [], installedPackages: [] };
		const mgr2 = new PackageManager(state2);
		await mgr2.installGit("my-ext", bareRepoUrl, {
			sourceUrl: bareRepoUrl,
			settingsFilePath,
			extensionsDir,
			gitDir,
			packagesRoot: "packages",
		});

		// The clone should now report v2.0.0 — proves fetch+reset ran
		const cloned = readdirSync(gitDir);
		const clonePath = join(gitDir, cloned[0]);
		const pj = JSON.parse(readFileSync(join(clonePath, "packages", "my-ext", "package.json"), "utf-8"));
		expect(pj.version).toBe("2.0.0");

		// Symlink target still resolves to the v2.0.0 directory
		const linkPath = join(extensionsDir, "my-ext");
		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
		const linkedPkgJson = JSON.parse(readFileSync(join(linkPath, "package.json"), "utf-8"));
		expect(linkedPkgJson.version).toBe("2.0.0");
	});

	it("throws when the package directory is missing in the cloned source", async () => {
		const state: RegistryState = { sources: [], installedPackages: [] };
		const mgr = new PackageManager(state);

		await expect(
			mgr.installGit("not-in-repo", bareRepoUrl, {
				sourceUrl: bareRepoUrl,
				settingsFilePath,
				extensionsDir,
				gitDir,
				packagesRoot: "packages",
			}),
		).rejects.toThrow(/not found in cloned source/);

		// The clone should still have happened — the source repo was cloned;
		// only the per-package directory was missing.
		const cloned = readdirSync(gitDir);
		expect(cloned).toHaveLength(1);
	});
});
