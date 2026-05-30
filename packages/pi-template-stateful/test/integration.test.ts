/**
 * Integration tests — verify full extension loading via dynamic import.
 *
 * Uses Map-based recording mocks (mirroring pi's actual Extension interface
 * shape) and validates the complete initialization path: imports resolve
 * against real pi packages, the factory initializes correctly, and all
 * registrations land in the right data structures.
 */

import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

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

function testContext(notify?: (...args: any[]) => void, entries?: ReadonlyArray<{ type: string; data?: unknown }>) {
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
		entries: entries ?? [],
	};
}

describe("pi-template-stateful integration — full extension loading", () => {
	it("dynamically imports the module and gets a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
		expect(mod.default.length).toBe(1);
	});

	it("factory populates one tool, one command, one event handler", async () => {
		const mod = await import("../src/index.js");
		const { api, tools, commands, handlers } = createRecordingMock();
		mod.default(api);

		expect(tools.size).toBe(1);
		expect(commands.size).toBe(1);
		expect(handlers.size).toBe(1);
		expect(tools.has("counter")).toBe(true);
		expect(commands.has("counter")).toBe(true);
		expect(handlers.has("session_start")).toBe(true);
	});

	describe("counter tool round-trip via Map", () => {
		it("increment from zero returns count=1 in details", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("counter")!;
			const result = await tool.execute("tc1", { action: "increment" }, undefined, undefined, testContext() as any);
			expect((result.details as any).count).toBe(1);
			expect(result.content[0]).toEqual({ type: "text", text: "Counter is now 1." });
		});
	});

	describe("/counter command via Map", () => {
		it("notifies the current value (default 0 before any tool call)", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createRecordingMock();
			mod.default(api);

			const messages: string[] = [];
			await commands.get("counter")!.handler("", testContext((m: string) => messages.push(m)) as any);
			expect(messages[0]).toBe("Counter: 0");
		});
	});

	describe("session_start reconstructs state from history", () => {
		it("walks entries to find the latest counter tool_result", async () => {
			const mod = await import("../src/index.js");
			const { api, handlers, commands } = createRecordingMock();
			mod.default(api);

			const ssHandlers = handlers.get("session_start")!;
			const entries = [
				{ type: "tool_result", data: { toolName: "counter", details: { action: "increment", count: 7 } } },
			];
			await ssHandlers[0]({} as any, testContext(undefined, entries) as any);

			const messages: string[] = [];
			await commands.get("counter")!.handler("", testContext((m: string) => messages.push(m)) as any);
			expect(messages[0]).toBe("Counter: 7");
		});
	});
});
