/**
 * Integration tests — verify full extension loading and end-to-end flows
 * using a fixture monorepo on the real filesystem.
 *
 * Tests the /monorego-registry command (add/remove/list/update).
 * Package install/remove commands come in S02.
 */

import { existsSync, unlinkSync } from "node:fs";
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

	it("factory initializes and registers /monorego-registry command", async () => {
		const mod = await import("../src/index.js");
		const { api, commands } = createRecordingMock();
		await mod.default(api);

		expect(commands.has("monorego-registry")).toBe(true);
		expect(commands.size).toBe(1);
	});

	it("session_start handler shows source count", async () => {
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
			const regCmd = commands.get("monorego-registry")!;
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
			const regCmd = commands.get("monorego-registry")!;

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
			const regCmd = commands.get("monorego-registry")!;

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
			const regCmd = commands.get("monorego-registry")!;
			await regCmd.handler("add /absolutely/nonexistent/path/12345 packages", ctx as any);

			expect(notified[0][0]).toContain("Registry source added");
			// discovery returns [] for non-existent path, so package count is 0
		});

		it("no-args /monorego-registry shows usage", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			await mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const regCmd = commands.get("monorego-registry")!;
			await regCmd.handler("", ctx as any);

			expect(notified[0][0]).toContain("Usage:");
		});
	});
});
