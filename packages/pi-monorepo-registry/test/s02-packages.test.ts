/**
 * S02 T02: Tests for packages.ts — PackageManager install/remove/update orchestration.
 *
 * Tests the three activation modes (dev, git, tarball), remove, and update operations.
 * Uses real filesystem operations in temp directories. Tarball download is tested
 * via a local tarball fixture (no network calls).
 */
import { execSync } from "node:child_process";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPackage, RegistryState } from "../src/types.js";
import {
	PACKAGE_ENTRY_TYPES,
	PackageManager,
	packageNameToDirName,
} from "../src/packages.js";

// --------------- Test fixtures ---------------

function createEmptyState(): RegistryState {
	return { sources: [], installedPackages: [] };
}

let tempDir: string;
let extensionsDir: string;
let gitDir: string;
let settingsFilePath: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `pkg-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	extensionsDir = join(tempDir, "extensions");
	gitDir = join(tempDir, "git");
	settingsFilePath = join(tempDir, "settings.json");
	mkdirSync(extensionsDir, { recursive: true });
	mkdirSync(gitDir, { recursive: true });
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

/** Create a minimal package directory with a package.json. */
function createPackageDir(parentDir: string, dirName: string, pkgName: string, version = "1.0.0"): string {
	const pkgDir = join(parentDir, dirName);
	mkdirSync(pkgDir, { recursive: true });
	writeSync(openSync(join(pkgDir, "package.json"), "w"), JSON.stringify({ name: pkgName, version }));
	return pkgDir;
}

/** Create a valid .tgz tarball containing a directory with a package.json. */
function createTestTarball(destPath: string, dirName: string, pkgName: string, version: string) {
	const staging = join(tempDir, `staging-${Date.now()}`);
	mkdirSync(join(staging, dirName), { recursive: true });
	writeSync(openSync(join(staging, dirName, "package.json"), "w"), JSON.stringify({ name: pkgName, version }));
	execSync(`tar -czf "${destPath}" -C "${staging}" "${dirName}"`, { stdio: "pipe" });
	rmSync(staging, { recursive: true, force: true });
}

// --------------- packageNameToDirName ---------------

describe("packageNameToDirName", () => {
	it("returns regular names unchanged", () => {
		expect(packageNameToDirName("pi-template")).toBe("pi-template");
	});

	it("encodes scoped package names", () => {
		expect(packageNameToDirName("@scope/pkg")).toBe("@scope-pkg");
	});

	it("handles deeply scoped names", () => {
		expect(packageNameToDirName("@my-org/my-pkg")).toBe("@my-org-my-pkg");
	});

	it("handles simple names without slashes", () => {
		expect(packageNameToDirName("my-extension")).toBe("my-extension");
	});
});

// --------------- installDev ---------------

describe("PackageManager.installDev", () => {
	it("creates symlink from extensions dir to local path", async () => {
		const localPath = createPackageDir(tempDir, "my-local-pkg", "pi-template");
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		const events = await mgr.installDev("pi-template", "/local/source", {
			localPath,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		// Verify symlink exists
		const linkPath = join(extensionsDir, "pi-template");
		expect(existsSync(linkPath)).toBe(true);
		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

		// Verify state updated
		expect(state.installedPackages).toHaveLength(1);
		expect(state.installedPackages[0]).toMatchObject({
			name: "pi-template",
			activationMode: "dev",
			targetPath: localPath,
			extensionDir: "pi-template",
		});

		// Verify event
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe(PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED);
		expect(events[0].data.packageName).toBe("pi-template");
		expect(events[0].data.activationMode).toBe("dev");
	});

	it("encodes scoped package names for dir", async () => {
		const localPath = createPackageDir(tempDir, "scoped-pkg", "@scope/pkg");
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installDev("@scope/pkg", "/local/source", {
			localPath,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		const linkPath = join(extensionsDir, "@scope-pkg");
		expect(existsSync(linkPath)).toBe(true);
		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
		expect(state.installedPackages[0].extensionDir).toBe("@scope-pkg");
	});

	it("throws if package is already installed", async () => {
		const localPath = createPackageDir(tempDir, "pkg", "pi-template");
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installDev("pi-template", "/source", {
			localPath,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		await expect(
			mgr.installDev("pi-template", "/source", {
				localPath,
				settingsFilePath,
				extensionsDir,
				gitDir,
			}),
		).rejects.toThrow(/already installed/);
	});

	it("throws if local path does not exist", async () => {
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await expect(
			mgr.installDev("pi-template", "/source", {
				localPath: "/nonexistent/path",
				settingsFilePath,
				extensionsDir,
				gitDir,
			}),
		).rejects.toThrow(/does not exist/);
	});

	it("registers extensions dir in settings.json", async () => {
		const localPath = createPackageDir(tempDir, "pkg", "pi-template");
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installDev("pi-template", "/source", {
			localPath,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		// Read settings file and verify
		const settings = JSON.parse(readFileSync(settingsFilePath, "utf-8"));
		expect(settings.extensions).toContain(extensionsDir);
	});

	it("replaces existing symlink on reinstall after remove", async () => {
		const localPath1 = createPackageDir(tempDir, "pkg-v1", "pi-template");
		const localPath2 = createPackageDir(tempDir, "pkg-v2", "pi-template");
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installDev("pi-template", "/source", {
			localPath: localPath1,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		await mgr.remove("pi-template", { settingsFilePath, extensionsDir });

		await mgr.installDev("pi-template", "/source", {
			localPath: localPath2,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		const linkPath = join(extensionsDir, "pi-template");
		expect(existsSync(linkPath)).toBe(true);
	});
});

// --------------- installGit ---------------

describe("PackageManager.installGit", () => {
	it("creates symlink to cloned repo package dir", async () => {
		// Simulate a cloned repo structure
		const clonedRepo = join(tempDir, "cloned-repo");
		const packagesDir = join(clonedRepo, "packages");
		createPackageDir(packagesDir, "pi-template", "pi-template");

		const state = createEmptyState();
		const mgr = new PackageManager(state);

		// Use a local path as sourceUrl so resolveSourceRoot treats it as local
		const events = await mgr.installGit("pi-template", clonedRepo, {
			sourceUrl: clonedRepo,
			settingsFilePath,
			extensionsDir,
			gitDir,
			packagesRoot: "packages",
		});

		// Verify symlink
		const linkPath = join(extensionsDir, "pi-template");
		expect(existsSync(linkPath)).toBe(true);
		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

		// Verify state
		expect(state.installedPackages).toHaveLength(1);
		expect(state.installedPackages[0].activationMode).toBe("git");
		expect(state.installedPackages[0].extensionDir).toBe("pi-template");

		// Verify event
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe(PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED);
		expect(events[0].data.activationMode).toBe("git");
	});

	it("throws if package directory not found in cloned source", async () => {
		const emptyRepo = join(tempDir, "cloned-repo-empty");
		mkdirSync(join(emptyRepo, "packages"), { recursive: true });

		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await expect(
			mgr.installGit("nonexistent-pkg", emptyRepo, {
				sourceUrl: emptyRepo,
				settingsFilePath,
				extensionsDir,
				gitDir,
			}),
		).rejects.toThrow(/not found in cloned source/);
	});

	it("throws if already installed", async () => {
		const clonedRepo = join(tempDir, "cloned-repo");
		const packagesDir = join(clonedRepo, "packages");
		createPackageDir(packagesDir, "pi-template", "pi-template");

		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installGit("pi-template", clonedRepo, {
			sourceUrl: clonedRepo,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		await expect(
			mgr.installGit("pi-template", clonedRepo, {
				sourceUrl: clonedRepo,
				settingsFilePath,
				extensionsDir,
				gitDir,
			}),
		).rejects.toThrow(/already installed/);
	});

	it("handles scoped packages with correct dir encoding", async () => {
		const clonedRepo = join(tempDir, "cloned-repo");
		const packagesDir = join(clonedRepo, "packages");
		createPackageDir(packagesDir, "@scope-pkg", "@scope/pkg");

		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installGit("@scope/pkg", clonedRepo, {
			sourceUrl: clonedRepo,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		const linkPath = join(extensionsDir, "@scope-pkg");
		expect(existsSync(linkPath)).toBe(true);
		expect(state.installedPackages[0].extensionDir).toBe("@scope-pkg");
	});
});

// --------------- installTarball ---------------

describe("PackageManager.installTarball", () => {
	it("downloads, extracts, and registers package", async () => {
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		// Mock downloadAndExtract to use a local tarball
		const tarballPath = join(tempDir, "pi-template-0.2.0.tgz");
		createTestTarball(tarballPath, "pi-template", "pi-template", "0.2.0");

		// We'll use vi.mock on the tarball module
		// Instead, let's use a simpler approach: create a pre-extracted directory
		// and mock downloadAndExtract by using vi.spyOn after import
		const extractedDir = join(extensionsDir, "pi-template");

		// Since we can't easily mock ESM imports in vitest without config,
		// test the tarball install via a local tarball extraction path.
		// Extract the tarball to extensions dir to simulate downloadAndExtract behavior
		execSync(`tar -xzf "${tarballPath}" -C "${extensionsDir}"`, { stdio: "pipe" });

		// Now test installTarball with a mocked download
		// We'll use a real test with a mock that resolves to the extracted path
		const tarball = await import("../src/tarball.js");
		const spy = vi.spyOn(tarball, "downloadAndExtract").mockResolvedValue({
			extractedPath: extractedDir,
			url: "https://github.com/test/repo/releases/download/test--v0.2.0/test-0.2.0.tgz",
			size: 1024,
		});

		const events = await mgr.installTarball("pi-template", "https://github.com/Zaephor/pi-extensions.git", {
			sourceUrl: "https://github.com/Zaephor/pi-extensions.git",
			version: "0.2.0",
			packagePath: "packages/pi-template",
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		spy.mockRestore();

		// Verify state
		expect(state.installedPackages).toHaveLength(1);
		expect(state.installedPackages[0]).toMatchObject({
			name: "pi-template",
			activationMode: "tarball",
			extensionDir: "pi-template",
		});

		// Verify event
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe(PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED);
		expect(events[0].data.activationMode).toBe("tarball");
		expect(events[0].data.version).toBe("0.2.0");
	});

	it("throws if already installed", async () => {
		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "https://github.com/test/repo",
			activationMode: "tarball",
			installedAt: new Date().toISOString(),
			targetPath: "/some/path",
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);

		await expect(
			mgr.installTarball("pi-template", "https://github.com/test/repo", {
				sourceUrl: "https://github.com/test/repo",
				version: "1.0.0",
				packagePath: "packages/pi-template",
				settingsFilePath,
				extensionsDir,
				gitDir,
			}),
		).rejects.toThrow(/already installed/);
	});
});

// --------------- remove ---------------

describe("PackageManager.remove", () => {
	it("removes tarball-installed package directory", async () => {
		const pkgDir = createPackageDir(extensionsDir, "pi-template", "pi-template");

		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "https://github.com/test/repo",
			activationMode: "tarball",
			installedAt: new Date().toISOString(),
			targetPath: pkgDir,
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);

		const events = await mgr.remove("pi-template", { settingsFilePath, extensionsDir });

		// Directory should be gone
		expect(existsSync(pkgDir)).toBe(false);

		// State should be empty
		expect(state.installedPackages).toHaveLength(0);

		// Event
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe(PACKAGE_ENTRY_TYPES.PACKAGE_REMOVED);
		expect(events[0].data.packageName).toBe("pi-template");
	});

	it("removes symlink for dev-installed package", async () => {
		const localPath = createPackageDir(tempDir, "local-pkg", "pi-template");
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await mgr.installDev("pi-template", "/source", {
			localPath,
			settingsFilePath,
			extensionsDir,
			gitDir,
		});

		const linkPath = join(extensionsDir, "pi-template");
		expect(existsSync(linkPath)).toBe(true);

		await mgr.remove("pi-template", { settingsFilePath, extensionsDir });

		// Symlink should be gone
		expect(existsSync(linkPath)).toBe(false);
		// Local path should still exist
		expect(existsSync(localPath)).toBe(true);
	});

	it("unregisters extensions dir when last package is removed", async () => {
		// Register settings
		writeSync(openSync(settingsFilePath, "w"), JSON.stringify({ extensions: [extensionsDir] }));

		const pkgDir = createPackageDir(extensionsDir, "pi-template", "pi-template");
		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "https://github.com/test/repo",
			activationMode: "tarball",
			installedAt: new Date().toISOString(),
			targetPath: pkgDir,
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);

		await mgr.remove("pi-template", { settingsFilePath, extensionsDir });

		// Settings should have extensions removed
		const settings = JSON.parse(readFileSync(settingsFilePath, "utf-8"));
		expect(settings.extensions).not.toContain(extensionsDir);
	});

	it("does not unregister when other packages remain", async () => {
		writeSync(openSync(settingsFilePath, "w"), JSON.stringify({ extensions: [extensionsDir] }));

		const pkgDir1 = createPackageDir(extensionsDir, "pkg-a", "pkg-a");
		const pkgDir2 = createPackageDir(extensionsDir, "pkg-b", "pkg-b");
		const state = createEmptyState();
		state.installedPackages.push(
			{
				name: "pkg-a",
				sourceUrl: "https://github.com/test/repo",
				activationMode: "tarball",
				installedAt: new Date().toISOString(),
				targetPath: pkgDir1,
				extensionDir: "pkg-a",
			},
			{
				name: "pkg-b",
				sourceUrl: "https://github.com/test/repo",
				activationMode: "tarball",
				installedAt: new Date().toISOString(),
				targetPath: pkgDir2,
				extensionDir: "pkg-b",
			},
		);
		const mgr = new PackageManager(state);

		await mgr.remove("pkg-a", { settingsFilePath, extensionsDir });

		// Settings should still have extensions dir
		const settings = JSON.parse(readFileSync(settingsFilePath, "utf-8"));
		expect(settings.extensions).toContain(extensionsDir);

		// One package remains
		expect(state.installedPackages).toHaveLength(1);
		expect(state.installedPackages[0].name).toBe("pkg-b");
	});

	it("throws if package is not installed", async () => {
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await expect(mgr.remove("nonexistent", { settingsFilePath, extensionsDir })).rejects.toThrow(
			/not installed/,
		);
	});
});

// --------------- update ---------------

describe("PackageManager.update", () => {
	it("updates tarball package by swapping directories", async () => {
		// Create initial installation
		const pkgDir = createPackageDir(extensionsDir, "pi-template", "pi-template", "0.1.0");
		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "https://github.com/Zaephor/pi-extensions.git",
			activationMode: "tarball",
			installedAt: "2025-01-01T00:00:00Z",
			targetPath: pkgDir,
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);

		// Create new version directory
		const newVersionDir = join(tempDir, "new-version", "pi-template");
		mkdirSync(join(tempDir, "new-version"), { recursive: true });
		mkdirSync(newVersionDir, { recursive: true });
		writeSync(
			openSync(join(newVersionDir, "package.json"), "w"),
			JSON.stringify({ name: "pi-template", version: "0.2.0" }),
		);

		// Mock downloadAndExtract to return new version dir
		const tarball = await import("../src/tarball.js");
		const spy = vi.spyOn(tarball, "downloadAndExtract").mockResolvedValue({
			extractedPath: newVersionDir,
			url: "https://github.com/Zaephor/pi-extensions/releases/download/pi-template--v0.2.0/pi-template-0.2.0.tgz",
			size: 2048,
		});

		const events = await mgr.update("pi-template", {
			sourceUrl: "https://github.com/Zaephor/pi-extensions.git",
			version: "0.2.0",
			packagePath: "packages/pi-template",
			settingsFilePath,
			extensionsDir,
		});

		spy.mockRestore();

		// Verify new version is in place
		const updatedPkgJson = JSON.parse(
			readFileSync(join(extensionsDir, "pi-template", "package.json"), "utf-8"),
		);
		expect(updatedPkgJson.version).toBe("0.2.0");

		// State updated
		expect(state.installedPackages[0].targetPath).toBe(join(extensionsDir, "pi-template"));

		// Event
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe(PACKAGE_ENTRY_TYPES.PACKAGE_UPDATED);
		expect(events[0].data.version).toBe("0.2.0");
	});

	it("throws if package is not installed", async () => {
		const state = createEmptyState();
		const mgr = new PackageManager(state);

		await expect(
			mgr.update("nonexistent", {
				sourceUrl: "https://github.com/test/repo",
				version: "1.0.0",
				packagePath: "packages/nonexistent",
				settingsFilePath,
				extensionsDir,
			}),
		).rejects.toThrow(/not installed/);
	});

	it("throws for non-tarball packages", async () => {
		const localPath = createPackageDir(tempDir, "local-pkg", "pi-template");
		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "/local",
			activationMode: "dev",
			installedAt: new Date().toISOString(),
			targetPath: localPath,
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);

		await expect(
			mgr.update("pi-template", {
				sourceUrl: "https://github.com/test/repo",
				version: "1.0.0",
				packagePath: "packages/pi-template",
				settingsFilePath,
				extensionsDir,
			}),
		).rejects.toThrow(/only supported for tarball/);
	});

	it("cleans up temp dir on download failure", async () => {
		const pkgDir = createPackageDir(extensionsDir, "pi-template", "pi-template", "0.1.0");
		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "https://github.com/Zaephor/pi-extensions.git",
			activationMode: "tarball",
			installedAt: "2025-01-01T00:00:00Z",
			targetPath: pkgDir,
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);

		// Mock downloadAndExtract to throw
		const tarball = await import("../src/tarball.js");
		const spy = vi.spyOn(tarball, "downloadAndExtract").mockRejectedValue(
			new Error("Download failed: HTTP 404"),
		);

		await expect(
			mgr.update("pi-template", {
				sourceUrl: "https://github.com/Zaephor/pi-extensions.git",
				version: "99.0.0",
				packagePath: "packages/pi-template",
				settingsFilePath,
				extensionsDir,
			}),
		).rejects.toThrow(/Download failed/);

		spy.mockRestore();

		// Original package should still exist
		expect(existsSync(pkgDir)).toBe(true);

		// No temp directories should remain in extensions dir
		const entries = execSync(`ls -la "${extensionsDir}"`, { encoding: "utf-8" });
		expect(entries).not.toContain(".tmp-update-");
	});
});

// --------------- listInstalled ---------------

describe("PackageManager.listInstalled", () => {
	it("returns empty array when no packages installed", () => {
		const mgr = new PackageManager(createEmptyState());
		expect(mgr.listInstalled()).toHaveLength(0);
	});

	it("returns all installed packages", () => {
		const state = createEmptyState();
		state.installedPackages.push(
			{
				name: "pkg-a",
				sourceUrl: "https://github.com/test/repo",
				activationMode: "dev",
				installedAt: "2025-01-01T00:00:00Z",
				targetPath: "/local/a",
				extensionDir: "pkg-a",
			},
			{
				name: "pkg-b",
				sourceUrl: "https://github.com/test/repo",
				activationMode: "tarball",
				installedAt: "2025-01-02T00:00:00Z",
				targetPath: "/ext/b",
				extensionDir: "pkg-b",
			},
		);
		const mgr = new PackageManager(state);
		expect(mgr.listInstalled()).toHaveLength(2);
	});
});

// --------------- findInstalled ---------------

describe("PackageManager.findInstalled", () => {
	it("finds package by name", () => {
		const state = createEmptyState();
		state.installedPackages.push({
			name: "pi-template",
			sourceUrl: "https://github.com/test/repo",
			activationMode: "tarball",
			installedAt: "2025-01-01T00:00:00Z",
			targetPath: "/ext/pi-template",
			extensionDir: "pi-template",
		});
		const mgr = new PackageManager(state);
		expect(mgr.findInstalled("pi-template")).toBeDefined();
		expect(mgr.findInstalled("pi-template")!.activationMode).toBe("tarball");
	});

	it("returns undefined for unknown package", () => {
		const mgr = new PackageManager(createEmptyState());
		expect(mgr.findInstalled("nonexistent")).toBeUndefined();
	});
});
