/**
 * Integration tests — verify full extension loading via dynamic import.
 *
 * These tests differ from unit tests by using Map-based recording mocks
 * (mirroring pi's actual Extension interface shape) and validating the
 * complete initialization path end-to-end.
 */

import type { Api, ExtensionAPI, ExtensionHandler, Model } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

/**
 * Create a recording mock that stores registrations in Maps,
 * matching the shape pi uses internally.
 */
function createRecordingMock() {
	const flags = new Map<string, { description?: string; type: string; default?: string | boolean }>();
	const flagValues = new Map<string, string | boolean | undefined>();
	const commands = new Map<
		string,
		{ description?: string; handler: (args: string, ctx: any) => Promise<void> | void }
	>();
	const handlers = new Map<string, ((...args: any[]) => unknown)[]>();

	const api = {
		registerTool() {
			// pi-co-author no longer registers a tool
		},
		registerCommand(name: string, options: any) {
			commands.set(name, { description: options.description, handler: options.handler });
		},
		registerFlag(name: string, options: { description?: string; type: string; default?: string | boolean }) {
			flags.set(name, options);
			flagValues.set(name, options.default);
		},
		getFlag(name: string) {
			return flagValues.get(name);
		},
		on(event: string, handler: ExtensionHandler<any, any>) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},

		// Stubs for remaining ExtensionAPI surface
		registerShortcut: () => {},
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
		events: {} as any,
	} as unknown as ExtensionAPI;

	return { api, flags, flagValues, commands, handlers };
}

/** Minimal context for invoking handlers in tests. */
function testContext(overrides?: { notify?: (...args: any[]) => void; model?: Model<Api> }) {
	return {
		ui: { notify: overrides?.notify ?? (() => {}) },
		hasUI: true,
		cwd: "/tmp",
		sessionManager: {} as any,
		modelRegistry: {} as any,
		model: overrides?.model ?? undefined,
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

describe("pi-co-author integration — full extension loading", () => {
	it("dynamically imports the module and gets a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
		expect(mod.default.length).toBe(1); // expects one argument: ExtensionAPI
	});

	it("factory initializes without errors and registers flags + handlers", async () => {
		const mod = await import("../src/index.js");
		const { api, flags, handlers } = createRecordingMock();
		mod.default(api);

		// Should register the co-author-mode flag
		expect(flags.has("co-author-mode")).toBe(true);
		// Should register two event handlers: tool_call + session_start
		expect(handlers.has("tool_call")).toBe(true);
		expect(handlers.has("session_start")).toBe(true);
	});
});

describe("flag registration", () => {
	it("registers co-author-mode flag with correct default", async () => {
		const mod = await import("../src/index.js");
		const { api, flags } = createRecordingMock();
		mod.default(api);

		const flag = flags.get("co-author-mode")!;
		expect(flag.type).toBe("string");
		expect(flag.default).toBe("single");
	});
});

describe("event registration", () => {
	it("registers tool_call handler", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		expect(handlers.get("tool_call")!).toHaveLength(1);
	});

	it("registers session_start handler", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		expect(handlers.get("session_start")!).toHaveLength(1);
	});

	it("session_start handler notifies extension loaded with mode", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const notified: any[] = [];
		const ctx = testContext({ notify: (...args: any[]) => notified.push(args) });
		const [handler] = handlers.get("session_start")!;
		await handler({ type: "session_start", reason: "startup" }, ctx as any);

		expect(notified).toHaveLength(1);
		expect(notified[0][0]).toContain("pi-co-author extension loaded");
		expect(notified[0][0]).toContain("single mode");
		expect(notified[0][1]).toBe("info");
	});
});

describe("tool_call handler behavior", () => {
	it("ignores non-bash tool calls", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const event = { type: "tool_call", toolCallId: "tc1", toolName: "read", input: { path: "/foo" } };
		const result = await handler(event, testContext() as any);

		// Should return undefined (no mutation, no block)
		expect(result).toBeUndefined();
		expect(event.input.path).toBe("/foo"); // unchanged
	});

	it("ignores bash commands that are not git commits", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const event = { type: "tool_call", toolCallId: "tc1", toolName: "bash", input: { command: "npm run build" } };
		await handler(event, testContext() as any);

		expect(event.input.command).toBe("npm run build"); // unchanged
	});

	it("rewrites git commit command with co-author trailer", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const event = {
			type: "tool_call",
			toolCallId: "tc1",
			toolName: "bash",
			input: { command: 'git commit -m "fix: typo"' },
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toContain("Co-Authored-By:");
		expect(event.input.command).toContain("fix: typo"); // original message preserved
	});

	it("does not rewrite when mode is disabled", async () => {
		const mod = await import("../src/index.js");
		const { api, flagValues, handlers } = createRecordingMock();
		mod.default(api);
		// Override the flag AFTER factory sets the default
		flagValues.set("co-author-mode", "disabled");

		const [handler] = handlers.get("tool_call")!;
		const event = {
			type: "tool_call",
			toolCallId: "tc1",
			toolName: "bash",
			input: { command: 'git commit -m "fix: typo"' },
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toBe('git commit -m "fix: typo"'); // unchanged
	});

	it("uses model name from context when available", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const model: Model<Api> = {
			id: "gpt-4o",
			name: "GPT-4o",
			api: "openai-responses" as Api,
			provider: "openai",
			baseUrl: "https://api.openai.com",
			reasoning: false,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		};
		const ctx = testContext({ model });

		const [handler] = handlers.get("tool_call")!;
		const event = {
			type: "tool_call",
			toolCallId: "tc1",
			toolName: "bash",
			input: { command: 'git commit -m "feat: new feature"' },
		};
		await handler(event, ctx as any);

		expect(event.input.command).toContain("GPT-4o");
	});
});

describe("cross-concern integration", () => {
	it("factory is idempotent — calling twice doubles event handlers", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();

		mod.default(api);
		mod.default(api);

		// on() appends, so two calls = two handlers per event
		expect(handlers.get("tool_call")!).toHaveLength(2);
		expect(handlers.get("session_start")!).toHaveLength(2);
	});

	it("full round-trip: import → factory → tool_call rewrites git commit", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const event = {
			type: "tool_call",
			toolCallId: "tc-e2e",
			toolName: "bash",
			input: { command: 'git commit -m "initial commit"' },
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toContain("initial commit");
		expect(event.input.command).toContain("Co-Authored-By:");
	});

	it("rewrites pi-style cd-prefixed git commit command", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const event = {
			type: "tool_call",
			toolCallId: "tc-cd-prefix",
			toolName: "bash",
			input: {
				command: 'cd /workspace/950e277ec2d0 && git add test-diag.txt && git commit -m "test diag"',
			},
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toContain("test diag");
		expect(event.input.command).toContain("Co-Authored-By:");
		expect(event.input.command).toContain("cd /workspace/950e277ec2d0 && git add test-diag.txt &&");
	});

	it("rewrites cd-prefixed git commit with combined flags", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const event = {
			type: "tool_call",
			toolCallId: "tc-cd-am",
			toolName: "bash",
			input: {
				command: 'cd /workspace/foo && git commit -am "fix bug"',
			},
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toContain("fix bug");
		expect(event.input.command).toContain("Co-Authored-By:");
	});

	it("ignores cd-prefixed git commit --amend", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const originalCommand = 'cd /workspace/foo && git commit --amend -m "fix typo"';
		const event = {
			type: "tool_call",
			toolCallId: "tc-cd-amend",
			toolName: "bash",
			input: { command: originalCommand },
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toBe(originalCommand); // unchanged
	});

	it("ignores cd-prefixed non-commit git commands", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const [handler] = handlers.get("tool_call")!;
		const originalCommand = "cd /workspace/foo && git add . && git status";
		const event = {
			type: "tool_call",
			toolCallId: "tc-cd-status",
			toolName: "bash",
			input: { command: originalCommand },
		};
		await handler(event, testContext() as any);

		expect(event.input.command).toBe(originalCommand); // unchanged
	});
});
