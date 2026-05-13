/**
 * S01 persistence tests — verify state load/save roundtrip and migration.
 *
 * Tests that loadState/saveState handle the new installedPackages field,
 * migrate older state files, and handle corruption gracefully.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// Crash safety — atomic writes and backup recovery
// ---------------------------------------------------------------------------
describe("crash safety", () => {
	const sampleState: RegistryState = {
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
				activationMode: "tarball",
				installedAt: "2025-01-01T00:00:00Z",
				targetPath: "/path/pkg-a",
				extensionDir: "pkg-a",
			},
		],
	};

	it("creates a PID-scoped backup file on save", async () => {
		await saveState(sampleState);

		// First save — no backup yet (nothing to back up)
		const files = readdirSync(tmpDir).filter((e) => e.startsWith("state.json.bak."));
		expect(files.length).toBe(0);

		// Second save with different data — should create backup of first
		const modified: RegistryState = {
			...sampleState,
			sources: [
				...sampleState.sources,
				{
					url: "https://github.com/org/repo2",
					shortName: "org/repo2",
					packagesRoot: "packages",
					packages: [],
					lastUpdated: "2025-01-02T00:00:00Z",
					rootPath: "/git/org/repo2",
				},
			],
		};
		await saveState(modified);

		// Backup should now exist with PID-scoped name
		const backups = readdirSync(tmpDir).filter((e) => e.startsWith("state.json.bak."));
		expect(backups.length).toBe(1);
		expect(backups[0]).toMatch(/^state\.json\.bak\.\d+\.\d+\.\d+\.[a-z0-9]+$/);

		// Backup should contain the first state (1 source)
		const backupRaw = await import("node:fs/promises").then((fs) => fs.readFile(join(tmpDir, backups[0]), "utf-8"));
		const backupParsed = JSON.parse(backupRaw);
		expect(backupParsed.sources.length).toBe(1); // original had 1 source
	});

	it("recovers from corrupted state.json using PID-scoped backup", async () => {
		// Save valid state first
		await saveState(sampleState);

		// Second save to create backup
		await saveState(sampleState);

		// Corrupt the primary file (simulates crash mid-write)
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, "{truncated...");

		// loadState should recover from backup
		const loaded = await loadState();
		expect(loaded.sources.length).toBe(1);
		expect(loaded.sources[0].url).toBe("https://github.com/org/repo");
		expect(loaded.installedPackages.length).toBe(1);
	});

	it("restores state.json from backup after recovery", async () => {
		await saveState(sampleState);
		await saveState(sampleState);

		// Corrupt primary
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, "bad");

		// Load triggers recovery + restore
		await loadState();

		// Primary file should now be restored
		const raw = await import("node:fs/promises").then((fs) => fs.readFile(statePath, "utf-8"));
		const parsed = JSON.parse(raw);
		expect(parsed.sources.length).toBe(1);
	});

	it("recovers from empty/truncated state.json using backup", async () => {
		await saveState(sampleState);
		await saveState(sampleState);

		// Empty file (truncated write)
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, "");

		const loaded = await loadState();
		expect(loaded.sources.length).toBe(1);
		expect(loaded.installedPackages.length).toBe(1);
	});

	it("returns empty state when primary and all backups are corrupted", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, "{bad");
		// Create a corrupted PID-scoped backup
		writeFileSync(join(tmpDir, "state.json.bak.1234567890.12345.abcd12"), "{also-bad");

		const loaded = await loadState();
		expect(loaded.sources).toEqual([]);
		expect(loaded.installedPackages).toEqual([]);
	});

	it("tries newest backup first when multiple exist", async () => {
		// Three saves: "oldest" → "middle" → "current"
		// After saves: state.json = "current", backups = ["middle" (newest), "oldest"]
		await saveState({
			...sampleState,
			sources: [{ ...sampleState.sources[0], url: "https://github.com/org/oldest" }],
		});
		await saveState({
			...sampleState,
			sources: [{ ...sampleState.sources[0], url: "https://github.com/org/middle" }],
		});
		await saveState({
			...sampleState,
			sources: [{ ...sampleState.sources[0], url: "https://github.com/org/current" }],
		});

		// Corrupt primary
		writeFileSync(join(tmpDir, "state.json"), "bad");

		const loaded = await loadState();
		// Should recover from the newest backup (which backed up "middle")
		expect(loaded.sources[0].url).toBe("https://github.com/org/middle");
	});

	it("prunes old backups beyond MAX_BACKUPS", async () => {
		// Save 7 times to create 6 backups (first save has nothing to back up)
		for (let i = 0; i < 7; i++) {
			await saveState({
				...sampleState,
				sources: [{ ...sampleState.sources[0], url: `https://github.com/org/repo-${i}` }],
			});
		}

		// Should keep only MAX_BACKUPS (5) backup files
		const backups = readdirSync(tmpDir).filter((e) => e.startsWith("state.json.bak."));
		expect(backups.length).toBeLessThanOrEqual(5);
	});

	it("cleans up stale temp files from crashed writes", async () => {
		// Simulate a leftover temp file from a crashed process
		writeFileSync(join(tmpDir, ".state.json.tmp.1234567890.abc123"), "stale");

		await saveState(sampleState);

		// Stale temp file should be cleaned up
		const temps = readdirSync(tmpDir).filter((e) => e.startsWith(".state.json.tmp."));
		expect(temps.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Advisory locking — concurrent access protection
// ---------------------------------------------------------------------------
describe("advisory locking", () => {
	it("cleans up lock after successful save", async () => {
		await saveState({ sources: [], installedPackages: [] });
		const lockDir = join(tmpDir, "state.json.lock");
		expect(existsSync(lockDir)).toBe(false);
	});

	it("cleans up lock after successful load", async () => {
		const statePath = join(tmpDir, "state.json");
		writeFileSync(statePath, JSON.stringify({ sources: [], installedPackages: [] }));
		await loadState();
		const lockDir = join(tmpDir, "state.json.lock");
		expect(existsSync(lockDir)).toBe(false);
	});

	it("serializes concurrent saves (no data loss)", async () => {
		// Three concurrent saves with different source URLs
		const saves = Array.from({ length: 3 }, (_, i) =>
			saveState({
				sources: [
					{
						url: `https://github.com/org/repo-${i}`,
						shortName: `org/repo-${i}`,
						packagesRoot: "packages",
						packages: [],
						lastUpdated: new Date().toISOString(),
						rootPath: `/git/org/repo-${i}`,
					},
				],
				installedPackages: [],
			}),
		);

		// All should complete without error
		await Promise.all(saves);

		// Final state should be valid (one of the three)
		const loaded = await loadState();
		expect(loaded.sources.length).toBe(1);
		expect(loaded.sources[0].url).toMatch(/repo-[012]$/);
	});

	it("handles save + load concurrency without corruption", async () => {
		// Write initial state
		await saveState({
			sources: [
				{
					url: "https://github.com/org/initial",
					shortName: "org/initial",
					packagesRoot: "packages",
					packages: [],
					lastUpdated: new Date().toISOString(),
					rootPath: "/git/org/initial",
				},
			],
			installedPackages: [],
		});

		// Concurrent load and save
		const [loaded] = await Promise.all([
			loadState(),
			saveState({
				sources: [
					{
						url: "https://github.com/org/concurrent",
						shortName: "org/concurrent",
						packagesRoot: "packages",
						packages: [],
						lastUpdated: new Date().toISOString(),
						rootPath: "/git/org/concurrent",
					},
				],
				installedPackages: [],
			}),
		]);

		// Load should have gotten either the initial or concurrent state
		expect(loaded.sources.length).toBeGreaterThanOrEqual(1);
	});
});
