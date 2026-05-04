/**
 * S01 persistence tests — verify state load/save roundtrip and migration.
 *
 * Tests that loadState/saveState handle the new installedPackages field,
 * migrate older state files, and handle corruption gracefully.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadState, saveState } from "../src/persistence.js";
import type { RegistryState } from "../src/types.js";

let tmpDir: string;
let _originalAgentDir: string | undefined;

function setupTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), "s01-persistence-"));
	return tmpDir;
}

// We need to mock getStateFilePath to point at our temp dir.
// persistence.ts imports getStateFilePath from paths.js, so we mock the module.
vi.mock("../src/paths.js", () => {
	let _statePath: string;

	return {
		getStateFilePath: () => _statePath,
		__setStatePath: (p: string) => {
			_statePath = p;
		},
	};
});

// Get the mock setter
const { __setStatePath } = vi.mocked(await import("../src/paths.js")) as unknown as {
	__setStatePath: (p: string) => void;
};

beforeEach(() => {
	const dir = setupTmpDir();
	__setStatePath(join(dir, "state.json"));
});

afterEach(() => {
	if (tmpDir && existsSync(tmpDir)) {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// loadState
// ---------------------------------------------------------------------------
describe("loadState", () => {
	it("returns empty state when no state file exists", async () => {
		const state = await loadState();
		expect(state.sources).toEqual([]);
		expect(state.installedPackages).toEqual([]);
	});

	it("loads sources and installedPackages from valid state file", async () => {
		const statePath = join(tmpDir, "state.json");
		const data: RegistryState = {
			sources: [
				{
					url: "https://github.com/org/repo",
					shortName: "org/repo",
					packagesRoot: "packages",
					packages: [
						{ name: "pkg-a", description: "A package", version: "1.0.0", path: "/some/path/pkg-a", isPiPackage: true },
					],
					lastUpdated: "2025-01-01T00:00:00Z",
					rootPath: "/git/repo",
				},
			],
			installedPackages: [
				{
					name: "pkg-a",
					sourceUrl: "https://github.com/org/repo",
					activationMode: "git",
					installedAt: "2025-01-01T00:00:00Z",
					targetPath: "/some/path/pkg-a",
					extensionDir: "pkg-a",
				},
			],
		};
		writeFileSync(statePath, JSON.stringify(data));

		const loaded = await loadState();
		expect(loaded.sources.length).toBe(1);
		expect(loaded.sources[0].url).toBe("https://github.com/org/repo");
		expect(loaded.sources[0].packages.length).toBe(1);
		expect(loaded.installedPackages.length).toBe(1);
		expect(loaded.installedPackages[0].name).toBe("pkg-a");
		expect(loaded.installedPackages[0].activationMode).toBe("git");
	});

	it("migrates old state format (no installedPackages) to empty array", async () => {
		const statePath = join(tmpDir, "state.json");
		const oldState = {
			sources: [
				{
					url: "https://github.com/org/repo",
					shortName: "org/repo",
					packagesRoot: "packages",
					packages: [],
					lastUpdated: "2025-01-01T00:00:00Z",
					rootPath: "/git/repo",
				},
			],
		};
		writeFileSync(statePath, JSON.stringify(oldState));

		const loaded = await loadState();
		expect(loaded.sources.length).toBe(1);
		expect(loaded.installedPackages).toEqual([]);
	});

	it("returns empty state for corrupted (malformed JSON) file", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, "{corrupt!!!");

		const loaded = await loadState();
		expect(loaded.sources).toEqual([]);
		expect(loaded.installedPackages).toEqual([]);
	});

	it("returns empty state when sources is not an array", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, JSON.stringify({ sources: "not-array" }));

		const loaded = await loadState();
		expect(loaded.sources).toEqual([]);
		expect(loaded.installedPackages).toEqual([]);
	});

	it("filters out invalid sources", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(
			statePath,
			JSON.stringify({
				sources: [
					{ url: "https://github.com/org/repo" },
					{ noUrl: true }, // invalid — missing url
					{ url: "https://github.com/org/repo2" },
				],
				installedPackages: [],
			}),
		);

		const loaded = await loadState();
		expect(loaded.sources.length).toBe(2);
	});

	it("filters out invalid installedPackages", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(
			statePath,
			JSON.stringify({
				sources: [],
				installedPackages: [
					{ name: "valid-pkg", targetPath: "/some/path" },
					{ noName: true }, // invalid — missing name
					{ name: "no-target" }, // invalid — missing targetPath
				],
			}),
		);

		const loaded = await loadState();
		expect(loaded.installedPackages.length).toBe(1);
		expect(loaded.installedPackages[0].name).toBe("valid-pkg");
	});

	it("fills in defaults for missing source fields", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(
			statePath,
			JSON.stringify({
				sources: [{ url: "https://github.com/org/repo" }],
				installedPackages: [],
			}),
		);

		const loaded = await loadState();
		const source = loaded.sources[0];
		expect(source.shortName).toBe("");
		expect(source.packagesRoot).toBe("packages");
		expect(source.packages).toEqual([]);
		expect(source.rootPath).toBe("https://github.com/org/repo");
	});
});

// ---------------------------------------------------------------------------
// saveState + loadState roundtrip
// ---------------------------------------------------------------------------
describe("saveState + loadState roundtrip", () => {
	it("roundtrips sources and installedPackages", async () => {
		const state: RegistryState = {
			sources: [
				{
					url: "https://github.com/org/repo",
					shortName: "org/repo",
					packagesRoot: "packages",
					packages: [{ name: "pkg-a", description: "Test", version: "1.0.0", path: "/path/pkg-a", isPiPackage: true }],
					lastUpdated: "2025-01-01T00:00:00Z",
					rootPath: "/git/org/repo",
				},
			],
			installedPackages: [
				{
					name: "pkg-a",
					sourceUrl: "https://github.com/org/repo",
					activationMode: "git",
					installedAt: "2025-01-01T00:00:00Z",
					targetPath: "/path/pkg-a",
					extensionDir: "pkg-a",
				},
			],
		};

		await saveState(state);
		const loaded = await loadState();

		expect(loaded.sources).toEqual(state.sources);
		expect(loaded.installedPackages).toEqual(state.installedPackages);
	});

	it("roundtrips empty state", async () => {
		await saveState({ sources: [], installedPackages: [] });
		const loaded = await loadState();

		expect(loaded.sources).toEqual([]);
		expect(loaded.installedPackages).toEqual([]);
	});

	it("creates directory if it doesn't exist", async () => {
		const nestedPath = join(tmpDir, "nested", "dir", "state.json");
		__setStatePath(nestedPath);

		await saveState({ sources: [], installedPackages: [] });
		expect(existsSync(nestedPath)).toBe(true);
	});
});
