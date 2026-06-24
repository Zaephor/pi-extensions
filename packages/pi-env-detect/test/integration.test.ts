/**
 * Integration tests — verify full extension loading via dynamic import.
 *
 * These tests differ from unit tests by using Map-based recording mocks
 * (mirroring pi's actual Extension interface shape) and validating the
 * complete initialization path end-to-end: imports resolve against real
 * pi packages, the factory initializes correctly, and all registrations
 * land in the right data structures.
 */

import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

/**
 * Create a recording mock that stores registrations in Maps,
 * matching the shape pi uses internally.
 */
function createRecordingMock() {
	const tools = new Map<string, ToolDefinition>();
	const commands = new Map<
		string,
		{ description?: string; handler: (args: string, ctx: any) => Promise<void> | void }
	>();
	const handlers = new Map<string, ((...args: never[]) => unknown)[]>();

	const api = {
		registerTool(tool: ToolDefinition) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, { description: options.description, handler: options.handler });
		},
		on(event: string, handler: ExtensionHandler<any, any>) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},

		// Stubs for remaining ExtensionAPI surface
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
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

	return { api, tools, commands, handlers };
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

describe("pi-env-detect integration — full extension loading", () => {
	it("dynamically imports the module and gets a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
		expect(mod.default.length).toBe(1); // expects one argument: ExtensionAPI
	});

	it("factory initializes without errors and populates all Maps", async () => {
		const mod = await import("../src/index.js");
		const { api, tools, commands, handlers } = createRecordingMock();
		mod.default(api);

		expect(tools.size).toBe(1);
		expect(commands.size).toBe(1);
		expect(handlers.size).toBe(1);
	});

	describe("tool registration via Map", () => {
		it("registers the 'hello' tool in the tools Map", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			expect(tools.has("hello")).toBe(true);
			const tool = tools.get("hello")!;
			expect(tool.name).toBe("hello");
			expect(tool.label).toBe("Hello");
			expect(tool.description).toBe("Greet someone by name");
		});

		it("tool has a valid TypeBox parameter schema", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("hello")!;
			const schema = tool.parameters;

			// TypeBox Object schema produces standard JSON Schema structure
			expect(schema.type).toBe("object");
			expect(schema.required).toContain("name");
			expect(schema.properties).toBeDefined();
			expect(schema.properties.name).toBeDefined();
			expect(schema.properties.name.type).toBe("string");
		});

		it("tool execute returns correct greeting", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("hello")!;
			const result = await tool.execute("tc1", { name: "Integration" }, undefined, undefined, testContext() as any);

			expect(result.content).toEqual([{ type: "text", text: "Hello, Integration!" }]);
			expect(result.details).toEqual({});
		});
	});

	describe("command registration via Map", () => {
		it("registers the 'greet' command in the commands Map", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			mod.default(api);

			expect(commands.has("greet")).toBe(true);
			const cmd = commands.get("greet")!;
			expect(cmd.description).toBeTruthy();
			expect(typeof cmd.handler).toBe("function");
		});

		it("greet command handler produces correct notification", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			await commands.get("greet")!.handler("Bob", ctx as any);

			expect(notified).toEqual([["Hello, Bob! 👋", "info"]]);
		});

		it("greet command handler defaults to 'world' with empty args", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			await commands.get("greet")!.handler("", ctx as any);

			expect(notified).toEqual([["Hello, world! 👋", "info"]]);
		});
	});

	describe("event registration via Map", () => {
		it("registers session_start handler in the handlers Map", async () => {
			const mod = await import("../src/index.js");
			const { api, handlers } = createRecordingMock();
			mod.default(api);

			expect(handlers.has("session_start")).toBe(true);
			expect(handlers.get("session_start")!).toHaveLength(1);
		});

		it("session_start handler notifies extension loaded", async () => {
			const mod = await import("../src/index.js");
			const { api, handlers } = createRecordingMock();
			mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const [handler] = handlers.get("session_start")!;
			await handler({}, ctx as any);

			expect(notified).toEqual([["pi-env-detect extension loaded ✅", "info"]]);
		});
	});

	describe("cross-concern integration", () => {
		it("factory is idempotent — calling twice doubles registrations", async () => {
			const mod = await import("../src/index.js");
			const { api, tools, commands, handlers } = createRecordingMock();

			mod.default(api);
			mod.default(api);

			// Second call appends — tools Map overwrites by key, commands too
			expect(tools.size).toBe(1); // same key overwrites
			expect(commands.size).toBe(1);
			expect(handlers.get("session_start")!).toHaveLength(2); // on() appends
		});

		it("full round-trip: import → factory → tool execute produces output", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("hello")!;
			const result = await tool.execute(
				"tc-roundtrip",
				{ name: "End-to-End" },
				undefined,
				undefined,
				testContext() as any,
			);

			expect(result.content[0].text).toBe("Hello, End-to-End!");
		});
	});
});
