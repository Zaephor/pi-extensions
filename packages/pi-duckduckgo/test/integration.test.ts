/**
 * Integration tests — verify full extension loading via dynamic import.
 *
 * Uses Map-based recording mocks (mirroring pi's actual Extension interface
 * shape) and validates the complete initialization path end-to-end.
 *
 * pi-duckduckgo is a tool-only extension — no commands or events.
 */

import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@mariozechner/pi-coding-agent";
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

/** Minimal context for invoking tool execute in tests. */
function testContext() {
	return {
		ui: { notify: () => {} },
		cwd: "/tmp",
	} as any;
}

describe("pi-duckduckgo integration — full extension loading", () => {
	it("dynamically imports the module and gets a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
		expect(mod.default.length).toBe(1); // expects one argument: ExtensionAPI
	});

	it("factory initializes without errors and registers exactly one tool", async () => {
		const mod = await import("../src/index.js");
		const { api, tools, commands, handlers } = createRecordingMock();
		mod.default(api);

		expect(tools.size).toBe(1);
		// Tool-only extension — no commands or events
		expect(commands.size).toBe(0);
		expect(handlers.size).toBe(0);
	});

	describe("tool registration via Map", () => {
		it("registers the 'duckduckgo_search' tool in the tools Map", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			expect(tools.has("duckduckgo_search")).toBe(true);
			const tool = tools.get("duckduckgo_search")!;
			expect(tool.name).toBe("duckduckgo_search");
			expect(tool.label).toBe("DuckDuckGo Search");
			expect(tool.description).toContain("DuckDuckGo");
		});

		it("tool has a valid TypeBox parameter schema", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("duckduckgo_search")!;
			const schema = tool.parameters;

			expect(schema.type).toBe("object");
			expect(schema.required).toContain("query");
			expect(schema.properties).toBeDefined();
			expect(schema.properties.query).toBeDefined();
			expect(schema.properties.query.type).toBe("string");
		});

		it("tool execute returns formatted results with mock fetch", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("duckduckgo_search")!;

			// Mock globalThis.fetch for the integration test
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async (url: string, _opts?: any) => {
				if (url.includes("html.duckduckgo.com")) {
					return new Response("some html vqd=testtoken123&more", { status: 200 });
				}
				if (url.includes("links.duckduckgo.com")) {
					return new Response(
						JSON.stringify({
							Results: [{ t: "Test Result", u: "https://example.com", a: "A test snippet" }],
						}),
						{ status: 200 },
					);
				}
				return new Response("not found", { status: 404 });
			}) as any;

			try {
				const result = await tool.execute("tc1", { query: "test" }, undefined, undefined, testContext());
				expect(result.content).toBeDefined();
				expect(result.content[0].type).toBe("text");
				expect(result.content[0].text).toContain("Test Result");
				expect(result.content[0].text).toContain("https://example.com");
				expect(result.details).toEqual({ resultCount: 1 });
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("tool execute handles errors gracefully", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("duckduckgo_search")!;

			// Mock fetch that returns a 500 error
			const originalFetch = globalThis.fetch;
			globalThis.fetch = async () => new Response("error", { status: 500 }) as any;

			try {
				const result = await tool.execute("tc2", { query: "fail" }, undefined, undefined, testContext());
				expect(result.content[0].text).toContain("Search failed");
				expect(result.details).toEqual({ error: true });
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe("cross-concern integration", () => {
		it("factory is idempotent — calling twice overwrites tool by key", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();

			mod.default(api);
			mod.default(api);

			// Second call overwrites by key — still just one tool
			expect(tools.size).toBe(1);
			expect(tools.has("duckduckgo_search")).toBe(true);
		});
	});
});
