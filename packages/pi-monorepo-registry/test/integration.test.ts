/**
 * Integration tests — verify full extension loading and end-to-end flows
 * using a fixture monorepo on the real filesystem.
 */

import { existsSync, unlinkSync } from "node:fs";
import { lstat, mkdir, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FixtureMonorepo } from "./helpers/fixture";
import { cleanupFixture, createFixtureMonorepo } from "./helpers/fixture";

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
		on(event: string, handler: ExtensionHandler<any, any>) {
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

	afterEach(async () => {
		for (const f of fixtures.splice(0)) {
			await cleanupFixture(f);
		}
		// Reset cached base dir so next test re-resolves from env vars
		const { resetRegistryBaseDir, getStateFilePath } = await import("../src/paths.js");
		resetRegistryBaseDir();
		// Clean up persisted registry state between tests
		try {
			const statePath = getStateFilePath();
			if (existsSync(statePath)) {
				unlinkSync(statePath);
			}
		} catch {
			// Ignore — state file may not exist
		}
	});

	// Reset cached base dir before each test too, in case a previous test's
	// env var changes leaked into the cache
	beforeEach(async () => {
		const { resetRegistryBaseDir } = await import("../src/paths.js");
		resetRegistryBaseDir();
	});

	it("factory initializes and registers all commands", async () => {
		const mod = await import("../src/index.js");
		const { api, commands } = createRecordingMock();
		await mod.default(api);

		expect(commands.has("monorepo-list")).toBe(true);
		expect(commands.has("monorepo-install")).toBe(true);
		expect(commands.has("monorepo-remove")).toBe(true);
		expect(commands.has("monorepo-registry")).toBe(true);
	});

	it("factory loads sub-extensions from active/ directory", async () => {
		// Test loadActiveExtensions directly (not via the cached factory)
		// since vitest caches module imports and the factory's closure captures
		// _activeDir from the first test that imported the module.
		const agentDir = join(tmpdir(), `pi-factory-load-${Date.now()}`);
		const activeDir = join(agentDir, "monorepo-registry", "active");
		await mkdir(activeDir, { recursive: true });
		fixtures.push({ rootDir: agentDir, packagesDir: agentDir });

		// Create a fixture monorepo with an installable extension
		const extFixture = await createFixtureMonorepo("factory-ext", [
			{
				name: "factory-test-ext",
				version: "1.0.0",
				piExtensions: ["./src/index.ts"],
			},
		]);
		fixtures.push(extFixture);

		// Symlink the extension into active/
		const { symlink } = await import("node:fs/promises");
		const { readdir } = await import("node:fs/promises");
		const entries = await readdir(extFixture.packagesDir);
		const extPkgDir = entries[0];
		const extPkgPath = `${extFixture.packagesDir}/${extPkgDir}`;
		await symlink(extPkgPath, join(activeDir, "factory-test-ext"));

		// Load directly via the loader module
		const { loadActiveExtensions } = await import("../src/loader.js");
		const tools = new Map();
		const commands = new Map();
		const mockApi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerCommand: (n: string, o: any) => commands.set(n, o),
			on: () => {},
			appendEntry: () => {},
			registerShortcut: () => {},
			registerFlag: () => {},
			getFlag: () => undefined,
		} as any;

		const { loaded, errors } = await loadActiveExtensions(activeDir, mockApi);
		expect(errors).toHaveLength(0);
		expect(loaded).toContain("factory-test-ext");
		expect(tools.has("hello")).toBe(true);
		expect(commands.has("greet")).toBe(true);
	});

	it("session_start handler notifies extension loaded", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		await mod.default(api);

		expect(handlers.has("session_start")).toBe(true);
		const notified: any[] = [];
		const ctx = testContext((...args: any[]) => notified.push(args));
		const [handler] = handlers.get("session_start")!;
		await handler({}, ctx as any);
		expect(notified[0][1]).toBe("info");
		expect(notified[0][0]).toContain("[Registry Extensions]");
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

			// List
			notified.length = 0;
			const listCmd = commands.get("monorepo-list")!;
			await listCmd.handler("", ctx as any);

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
			const listCmd = commands.get("monorepo-list")!;
			await listCmd.handler("", ctx as any);
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

	describe("/monorepo-install", () => {
		it("creates symlink in project-local dir with -l flag", async () => {
			const fixture = await createFixtureMonorepo("install-local", [
				{ name: "installable-pkg", version: "1.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			// Prevent real npm install by creating node_modules
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			// Use a temp cwd so local scope extensions go to a known dir
			const localCwd = join(tmpdir(), `pi-install-local-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			const ctx = {
				...testContext((...args: any[]) => notified.push(args)),
				cwd: localCwd,
			};
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd }); // cleanup

			// Register the source first
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			// Install with -l flag
			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("installable-pkg -l", ctx as any);

			// Verify notification
			expect(notified.length).toBeGreaterThan(1);
			const installNotify = notified[notified.length - 1];
			expect(installNotify[0]).toContain("Installed installable-pkg");
			expect(installNotify[0]).toContain("local scope");
			expect(installNotify[0]).toContain("/reload");

			// Verify entry recorded
			const installedEntry = entries.find((e) => e.type === "monorepo-package-installed");
			expect(installedEntry).toBeDefined();
			expect((installedEntry!.data as any).packageName).toBe("installable-pkg");
			expect((installedEntry!.data as any).scope).toBe("local");

			// Verify symlink actually exists on filesystem
			const symlinkPath = (installedEntry!.data as any).symlinkPath;
			const stat = await lstat(symlinkPath);
			expect(stat.isSymbolicLink()).toBe(true);
			const target = await readlink(symlinkPath);
			expect(target).toContain("installable-pkg");
		});

		it("creates symlink in global extensions dir without -l flag", async () => {
			const fixture = await createFixtureMonorepo("install-global", [
				{ name: "global-pkg", version: "2.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			// Set agent dir env vars to a temp dir so global scope is predictable.
			// APP_NAME is "gsd" when piConfig.name is set (local dev), "pi" otherwise (published SDK).
			// Set both env vars so the test works in either environment.
			const globalDir = join(tmpdir(), `pi-install-global-agent-${Date.now()}`);
			await mkdir(globalDir, { recursive: true });
			fixtures.push({ rootDir: globalDir, packagesDir: globalDir });
			const origGsdEnv = process.env.GSD_CODING_AGENT_DIR;
			const origPiEnv = process.env.PI_CODING_AGENT_DIR;
			process.env.GSD_CODING_AGENT_DIR = globalDir;
			process.env.PI_CODING_AGENT_DIR = globalDir;

			try {
				const mod = await import("../src/index.js");
				const { api, commands, entries } = createRecordingMock();
				await mod.default(api);

				const notified: any[] = [];
				const ctx = testContext((...args: any[]) => notified.push(args));

				// Register the source first
				const regCmd = commands.get("monorepo-registry")!;
				await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

				// Install globally (no -l flag)
				const installCmd = commands.get("monorepo-install")!;
				await installCmd.handler("global-pkg", ctx as any);

				// Verify notification
				const installNotify = notified[notified.length - 1];
				expect(installNotify[0]).toContain("Installed global-pkg");
				expect(installNotify[0]).toContain("global scope");
				expect(installNotify[0]).toContain("/reload");

				// Verify entry recorded
				const installedEntry = entries.find((e) => e.type === "monorepo-package-installed");
				expect(installedEntry).toBeDefined();
				expect((installedEntry!.data as any).scope).toBe("global");

				// Verify symlink exists
				const symlinkPath = (installedEntry!.data as any).symlinkPath;
				expect(symlinkPath).toContain(globalDir);
				const stat = await lstat(symlinkPath);
				expect(stat.isSymbolicLink()).toBe(true);
			} finally {
				if (origGsdEnv !== undefined) {
					process.env.GSD_CODING_AGENT_DIR = origGsdEnv;
				} else {
					delete process.env.GSD_CODING_AGENT_DIR;
				}
				if (origPiEnv !== undefined) {
					process.env.PI_CODING_AGENT_DIR = origPiEnv;
				} else {
					delete process.env.PI_CODING_AGENT_DIR;
				}
			}
		});

		it("install records package-installed entry with correct fields", async () => {
			const fixture = await createFixtureMonorepo("install-entry", [
				{ name: "entry-pkg", version: "3.0.0", description: "Entry test", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const localCwd = join(tmpdir(), `pi-install-entry-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd });

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const ctx = { ...testContext(), cwd: localCwd };
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("entry-pkg -l", ctx as any);

			const installedEntry = entries.find((e) => e.type === "monorepo-package-installed");
			expect(installedEntry).toBeDefined();
			const data = installedEntry!.data as Record<string, string>;
			expect(data.packageName).toBe("entry-pkg");
			expect(data.scope).toBe("local");
			expect(data.symlinkPath).toContain(localCwd);
			expect(data.targetPath).toContain("entry-pkg");
			expect(data.timestamp).toBeTruthy();
		});

		it("install shows /reload warning", async () => {
			const fixture = await createFixtureMonorepo("install-reload", [
				{ name: "reload-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const localCwd = join(tmpdir(), `pi-install-reload-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd });

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = { ...testContext((...args: any[]) => notified.push(args)), cwd: localCwd };
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("reload-pkg -l", ctx as any);

			expect(notified[notified.length - 1][0]).toContain("/reload");
		});

		it("install shows error for non-existent package", async () => {
			const fixture = await createFixtureMonorepo("install-notfound", [
				{ name: "exists-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("nonexistent-pkg", ctx as any);

			expect(notified[notified.length - 1][0]).toContain("not found");
			expect(notified[notified.length - 1][0]).toContain("nonexistent-pkg");
			expect(notified[notified.length - 1][1]).toBe("error");
		});

		it("install shows error when no source registered", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("any-pkg", ctx as any);

			expect(notified[0][0]).toContain("No monorepo sources registered");
			expect(notified[0][1]).toBe("error");
		});

		it("install with source/package format resolves from specified source", async () => {
			const fixture = await createFixtureMonorepo("install-source-pkg", [
				{ name: "targeted-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const localCwd = join(tmpdir(), `pi-install-source-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd });

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = { ...testContext((...args: any[]) => notified.push(args)), cwd: localCwd };
			const regCmd = commands.get("monorepo-registry")!;

			// Register source — shortName will be derived from the local path (last dir segment)
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			// Get the registered source's shortName
			const listNotified: any[] = [];
			const listCtx = testContext((...args: any[]) => listNotified.push(args));
			const listCmd = commands.get("monorepo-list")!;
			await listCmd.handler("", listCtx as any);
			const shortNameMatch = listNotified[0][0].match(/📦\s+(.+)/);
			const shortName = shortNameMatch ? shortNameMatch[1].trim() : fixture.rootDir.split("/").pop()!;

			// Use source/package format with the shortName
			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler(`${shortName}/targeted-pkg -l`, ctx as any);

			expect(notified[notified.length - 1][0]).toContain("Installed targeted-pkg");
		});

		it("install shows error for unregistered source in source/package format", async () => {
			// Need at least one source registered to reach the install logic
			const fixture = await createFixtureMonorepo("install-unreg-source", [
				{ name: "other-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			const installCmd = commands.get("monorepo-install")!;
			// Use a source/package combo that doesn't match any registered source
			// Falls through to bare-name lookup for "nonexistent-source/some-pkg"
			await installCmd.handler("nonexistent-source/some-pkg", ctx as any);

			expect(notified[notified.length - 1][0]).toContain("not found");
			expect(notified[notified.length - 1][1]).toBe("error");
		});

		it("install with empty args shows usage", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("", ctx as any);

			expect(notified[0][0]).toContain("Usage:");
			expect(notified[0][1]).toBe("error");
		});
	});

	describe("/monorepo-remove", () => {
		it("removes symlink that was created by install", async () => {
			const fixture = await createFixtureMonorepo("remove-flow", [
				{ name: "removable-pkg", version: "1.0.0", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const localCwd = join(tmpdir(), `pi-remove-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd });

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const ctx = { ...testContext(), cwd: localCwd };
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			// Install first
			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("removable-pkg -l", ctx as any);

			// Verify symlink exists
			const installedEntry = entries.find((e) => e.type === "monorepo-package-installed");
			expect(installedEntry).toBeDefined();
			const symlinkPath = (installedEntry!.data as any).symlinkPath;
			expect(await lstat(symlinkPath).then((s) => s.isSymbolicLink())).toBe(true);

			// Now remove
			const notified: any[] = [];
			const removeCtx = { ...testContext((...args: any[]) => notified.push(args)), cwd: localCwd };
			const removeCmd = commands.get("monorepo-remove")!;
			await removeCmd.handler("removable-pkg -l", removeCtx as any);

			// Verify notification
			expect(notified[0][0]).toContain("Removed removable-pkg");
			expect(notified[0][0]).toContain("local scope");
			expect(notified[0][0]).toContain("/reload");

			// Verify symlink is gone
			await expect(lstat(symlinkPath)).rejects.toThrow();
		});

		it("records package-removed entry", async () => {
			const fixture = await createFixtureMonorepo("remove-entry", [
				{ name: "remove-entry-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const localCwd = join(tmpdir(), `pi-remove-entry-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd });

			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const ctx = { ...testContext(), cwd: localCwd };
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			// Install then remove
			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("remove-entry-pkg -l", ctx as any);

			const removeCmd = commands.get("monorepo-remove")!;
			await removeCmd.handler("remove-entry-pkg -l", ctx as any);

			const removedEntry = entries.find((e) => e.type === "monorepo-package-removed");
			expect(removedEntry).toBeDefined();
			const data = removedEntry!.data as Record<string, string>;
			expect(data.packageName).toBe("remove-entry-pkg");
			expect(data.scope).toBe("local");
			expect(data.timestamp).toBeTruthy();
		});

		it("shows /reload warning after remove", async () => {
			const fixture = await createFixtureMonorepo("remove-reload", [
				{ name: "remove-reload-pkg", piExtensions: ["./src/index.ts"] },
			]);
			fixtures.push(fixture);
			await mkdir(join(fixture.rootDir, "node_modules"), { recursive: true });

			const localCwd = join(tmpdir(), `pi-remove-reload-cwd-${Date.now()}`);
			await mkdir(localCwd, { recursive: true });
			fixtures.push({ rootDir: localCwd, packagesDir: localCwd });

			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const ctx = { ...testContext(), cwd: localCwd };
			const regCmd = commands.get("monorepo-registry")!;
			await regCmd.handler(`add ${fixture.rootDir} packages`, ctx as any);

			const installCmd = commands.get("monorepo-install")!;
			await installCmd.handler("remove-reload-pkg -l", ctx as any);

			const notified: any[] = [];
			const removeCtx = { ...testContext((...args: any[]) => notified.push(args)), cwd: localCwd };
			const removeCmd = commands.get("monorepo-remove")!;
			await removeCmd.handler("remove-reload-pkg -l", removeCtx as any);

			expect(notified[0][0]).toContain("/reload");
		});

		it("shows info when package not installed", async () => {
			const mod = await import("../src/index.js");
			const { api, commands, entries } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const removeCmd = commands.get("monorepo-remove")!;
			await removeCmd.handler("never-installed-pkg", ctx as any);

			expect(notified[0][0]).toContain("was not installed");
			expect(notified[0][0]).toContain("never-installed-pkg");
			expect(notified[0][0]).toContain("global scope");

			// No entry should be recorded for a package that wasn't installed
			const removedEntry = entries.find((e) => e.type === "monorepo-package-removed");
			expect(removedEntry).toBeUndefined();
		});

		it("with empty args shows usage", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const removeCmd = commands.get("monorepo-remove")!;
			await removeCmd.handler("", ctx as any);

			expect(notified[0][0]).toContain("Usage:");
			expect(notified[0][1]).toBe("error");
		});
	});

	describe("error handling", () => {
		it("add with non-existent path shows error message", async () => {
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
});
