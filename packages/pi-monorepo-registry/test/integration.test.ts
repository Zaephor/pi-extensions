/**
 * Integration tests — verify full extension loading and end-to-end flows
 * using a fixture monorepo on the real filesystem.
 *
 * Tests both commands:
 *   /monorepo-registry — add/remove/list/update sources
 *   /monorepo-package  — install/remove/update/list packages
 *
 * IMPORTANT: All state persistence is redirected to a temp directory via
 * vi.mock("../src/paths.js") so tests never touch ~/.gsd/monorepo/.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixtureMonorepo } from "./helpers/fixture";
import { cleanupFixture, createFixtureMonorepo } from "./helpers/fixture";

// ---------------------------------------------------------------------------
// Mock paths.js to redirect all filesystem operations to a temp directory.
// Without this mock, tests would read/write to the REAL ~/.gsd/monorepo/.
// Must be at module scope — vi.mock is hoisted by Vitest.
// ---------------------------------------------------------------------------
vi.mock("../src/paths.js", () => {
	let _statePath: string;
	return {
		getStateFilePath: () => _statePath,
		getExtensionsDir: () => _statePath.replace(/state\.json$/, "extensions"),
		getGitDir: () => _statePath.replace(/state\.json$/, "git"),
		getSettingsFilePath: () => _statePath.replace(/monorepo\/state\.json$/, "agent/settings.json"),
		getMonorepoDir: () => _statePath.replace(/\/state\.json$/, ""),
		getRegistryBaseDir: () => _statePath.replace(/\/monorepo\/state\.json$/, "/agent"),
		resetRegistryBaseDir: () => {},
		__setStatePath: (p: string) => {
			_statePath = p;
		},
	};
});

const pathsMock = (await import("../src/paths.js")) as unknown as {
	__setStatePath: (p: string) => void;
};

/**
 * Create a recording mock that captures appendEntry calls,
 * matching the shape pi uses internally.
 */
function createRecordingMock() {
	const commands = new Map<
		string,
		{ description?: string; handler: (args: string, ctx: any) => Promise<void> | void }
	>();
	const handlers = new Map<string, ((...args: any[]) => unknown)[]>();
	const entries: Array<{ type: string; data?: unknown }> = [];

	const api = {
		registerCommand(name: string, options: any) {
			commands.set(name, { description: options.description, handler: options.handler });
		},
		on(event: string, handler: any) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		appendEntry(type: string, data?: unknown) {
			entries.push({ type, data });
		},
		registerTool: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
		getActiveTools: () => [] as string[],
		getAllTools: () => [] as any[],
		setActiveTools: () => {},
		getCommands: () => [] as any[],
		setModel: async () => false,
		getThinkingLevel: () => "none" as any,
		setThinkingLevel: () => {},
		registerProvider: () => {},
	} as unknown as ExtensionAPI;

	return { api, commands, handlers, entries };
}

/** Minimal context for invoking handlers in tests. */
function testContext(notify?: (...args: any[]) => void) {
	return {
		ui: { notify: notify ?? (() => {}) },
		hasUI: true,
		cwd: "/tmp",
		sessionManager: {} as any,
		modelRegistry: {} as any,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

describe("pi-monorepo-registry integration", () => {
	const fixtures: FixtureMonorepo[] = [];
	let _tmpDir: string;

	beforeEach(() => {
		_tmpDir = mkdtempSync(join(tmpdir(), "pi-reg-integration-"));
		pathsMock.__setStatePath(join(_tmpDir, "monorepo", "state.json"));
	});

	afterEach(async () => {
		for (const f of fixtures.splice(0)) {
			await cleanupFixture(f);
		}
		// Clean up temp state directory
		if (_tmpDir && existsSync(_tmpDir)) {
			rmSync(_tmpDir, { recursive: true, force: true });
		}
	});

	it("factory initializes and registers /monorepo-registry and /monorepo-package commands", async () => {
		const mod = await import("../src/index.js");
		const { api, commands } = createRecordingMock();
		await mod.default(api);

		expect(commands.has("monorepo-registry")).toBe(true);
		expect(commands.has("monorepo-package")).toBe(true);
		expect(commands.size).toBe(2);
	});

	it("session_start handler shows source and package count", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		await mod.default(api);

		expect(handlers.has("session_start")).toBe(true);
		const notified: any[] = [];
		const ctx = testContext((...args: any[]) => notified.push(args));
		const [handler] = handlers.get("session_start")!;
		await handler({}, ctx as any);
		expect(notified[0][1]).toBe("info");
		expect(notified[0][0]).toContain("[Registry]");
		expect(notified[0][0]).toContain("0 source");
		expect(notified[0][0]).toContain("0 package");
	});

	describe("end-to-end: add → list → remove", () => {
		it("discovers packages from a fixture monorepo", async () => {
			const fixture = await createFixtureMonorepo("e2e-add-list", [
				{ name: "@scope/plugin-a", version: "1.2.0", description: "Plugin A", piExtensions: ["./src/index.ts"] },
				{ name: "plugin-b", keywords: ["pi-package"] },
				{ name: "not-a-plugin" }, // no pi manifest — should not be discovered
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			// Add source
			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			expect(notified.length).toBeGreaterThan(0);
			expect(notified[0][0]).toContain("Registry source added");
			expect(notified[0][0]).toContain("2 package");

			// Verify state transitions recorded
			const addedEntry = entries.find((e) => e.type === "monorepo-source-added");
			expect(addedEntry).toBeDefined();
			expect((addedEntry!.data as any).source).toBe(fixture.rootDir);

			const discEntry = entries.find((e) => e.type === "monorepo-packages-discovered");
			expect(discEntry).toBeDefined();
			expect((discEntry!.data as any).packages).toHaveLength(2);

			// List via subcommand
			notified.length = 0;
			await regCmd.handler("list", ctx as any);

			expect(notified[0][0]).toContain("@scope/plugin-a");
			expect(notified[0][0]).toContain("plugin-b");
			expect(notified[0][0]).not.toContain("not-a-plugin");
		});

		it("removes a source and list reflects the removal", async () => {
			const fixture = await createFixtureMonorepo("e2e-remove", [{ name: "rm-pkg", piExtensions: ["./src/index.ts"] }]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;

			// Add then remove
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);
			await regCmd.handler(`remove ${fixture.rootDir}`, ctx as any);

			const removedEntry = entries.find((e) => e.type === "monorepo-source-removed");
			expect(removedEntry).toBeDefined();

			// List should show empty
			notified.length = 0;
			await regCmd.handler("list", ctx as any);
			expect(notified[0][0]).toContain("No monorepo sources registered");
		});

		it("update re-discovers packages after filesystem change", async () => {
			const fixture = await createFixtureMonorepo("e2e-update", [
				{ name: "update-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;

			// Add with empty initial state (packages already discovered)
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			// Update re-discovers
			notified.length = 0;
			await regCmd.handler(`update ${fixture.rootDir}`, ctx as any);

			expect(notified[0][0]).toContain("Updated");
			expect(notified[0][0]).toContain("1 package");
		});
	});

	describe("error handling", () => {
		it("add with non-existent path succeeds with 0 packages", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler("add /absolutely/nonexistent/path/12345 packages", ctx as any);

			expect(notified[0][0]).toContain("Registry source added");
			// discovery returns [] for non-existent path, so package count is 0
		});

		it("no-args /monorepo-registry shows usage", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler("", ctx as any);

			expect(notified[0][0]).toContain("Usage:");
		});
	});

	describe("/monorepo-package command", () => {
		it("install --dev with fixture monorepo installs and registers symlink", async () => {
			const fixture = await createFixtureMonorepo("pkg-dev", [
				{ name: "test-plugin", version: "1.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			const localPath = join(fixture.packagesDir, "test-plugin");
			await pkgCmd.handler(`install test-plugin --dev ${localPath}`, ctx as any);

			// Should notify success with /reload reminder
			expect(notified.length).toBe(1);
			expect(notified[0][0]).toContain("test-plugin");
			expect(notified[0][0]).toContain("installed");
			expect(notified[0][0]).toContain("/reload");
			expect(notified[0][1]).toBe("info");

			// Should record event
			const installedEntry = entries.find((e) => e.type === "monorepo-package-installed");
			expect(installedEntry).toBeDefined();
			expect((installedEntry!.data as any).packageName).toBe("test-plugin");
			expect((installedEntry!.data as any).activationMode).toBe("dev");

			// List should show installed package
			notified.length = 0;
			await pkgCmd.handler("list", ctx as any);
			expect(notified[0][0]).toContain("test-plugin");
			expect(notified[0][0]).toContain("dev (symlink)");
		});

		it("remove after install cleans up and unregisters", async () => {
			const fixture = await createFixtureMonorepo("pkg-remove", [
				{ name: "removable-pkg", version: "2.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			// Install first
			const localPath = join(fixture.packagesDir, "removable-pkg");
			await pkgCmd.handler(`install removable-pkg --dev ${localPath}`, ctx as any);
			expect(notified[0][0]).toContain("installed");

			// Remove
			notified.length = 0;
			await pkgCmd.handler("remove removable-pkg", ctx as any);

			expect(notified[0][0]).toContain("removed");
			expect(notified[0][0]).toContain("/reload");

			// Should record removal event
			const removedEntry = entries.find((e) => e.type === "monorepo-package-removed");
			expect(removedEntry).toBeDefined();
			expect((removedEntry!.data as any).packageName).toBe("removable-pkg");

			// List should show empty
			notified.length = 0;
			await pkgCmd.handler("list", ctx as any);
			expect(notified[0][0]).toContain("No packages installed");
		});

		it("list shows all installed packages with activation mode", async () => {
			const fixtureA = await createFixtureMonorepo("pkg-list-a", [
				{ name: "pkg-alpha", version: "1.0.0", piExtensions: ["./src/index.ts"] },
			]);
			const fixtureB = await createFixtureMonorepo("pkg-list-b", [
				{ name: "pkg-beta", version: "3.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixtureA, fixtureB);

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			// Install both
			await pkgCmd.handler(`install pkg-alpha --dev ${join(fixtureA.packagesDir, "pkg-alpha")}`, ctx as any);
			await pkgCmd.handler(`install pkg-beta --dev ${join(fixtureB.packagesDir, "pkg-beta")}`, ctx as any);

			// List should show both
			notified.length = 0;
			await pkgCmd.handler("list", ctx as any);

			expect(notified[0][0]).toContain("pkg-alpha");
			expect(notified[0][0]).toContain("pkg-beta");
			expect(notified[0][0]).toContain("dev (symlink)");
		});

		it("install fails when package already installed", async () => {
			const fixture = await createFixtureMonorepo("pkg-dup", [
				{ name: "dup-pkg", version: "1.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			const localPath = join(fixture.packagesDir, "dup-pkg");
			await pkgCmd.handler(`install dup-pkg --dev ${localPath}`, ctx as any);
			expect(notified[0][1]).toBe("info");

			// Second install should fail
			notified.length = 0;
			await pkgCmd.handler(`install dup-pkg --dev ${localPath}`, ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("already installed");
		});

		it("remove fails when package not installed", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			await pkgCmd.handler("remove nonexistent-pkg", ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("not installed");
		});

		it("install fails with missing package name", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			await pkgCmd.handler("install", ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("package name required");
		});

		it("no-args /monorepo-package shows usage", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;
			await pkgCmd.handler("", ctx as any);

			expect(notified[0][0]).toContain("Usage:");
		});

		it("unknown subcommand shows error", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;
			await pkgCmd.handler("bogus", ctx as any);

			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("Unknown subcommand");
		});

		it("install --dev fails when local path does not exist", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			await pkgCmd.handler("install broken-pkg --dev /absolutely/nonexistent/path", ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("does not exist");
		});

		it("install without --dev requires a registered source", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			// No source registered, tarball mode should fail
			await pkgCmd.handler("install some-pkg", ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("No source found");
		});

		it("update fails when package not installed", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			await pkgCmd.handler("update some-pkg --version 2.0.0", ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("not installed");
		});

		it("update fails for non-tarball packages", async () => {
			const fixture = await createFixtureMonorepo("pkg-update-mode", [
				{ name: "dev-pkg", version: "1.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const pkgCmd = commands.get("monorepo-package")!;

			// Install as dev mode
			const localPath = join(fixture.packagesDir, "dev-pkg");
			await pkgCmd.handler(`install dev-pkg --dev ${localPath}`, ctx as any);

			// Try to update — should fail
			notified.length = 0;
			await pkgCmd.handler("update dev-pkg --version 2.0.0", ctx as any);
			expect(notified[0][1]).toBe("error");
			expect(notified[0][0]).toContain("only supported for tarball");
		});
	});
});
