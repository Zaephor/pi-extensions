/**
 * Integration tests — exercise the factory via recording mocks. Verifies
 * the hook handler is registered for `tool_call`, that it mutates bash
 * inputs containing secrets, leaves clean inputs alone, and emits an
 * audit entry every time.
 */

import type { ExtensionAPI, ExtensionHandler } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

function createRecordingMock() {
	const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
	const entries: Array<{ type: string; data: unknown }> = [];

	const api = {
		on(event: string, handler: ExtensionHandler<any, any>) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		appendEntry(type: string, data: unknown) {
			entries.push({ type, data });
		},
		registerTool: () => {},
		registerCommand: () => {},
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

	return { api, handlers, entries };
}

function testContext() {
	return {
		ui: { notify: () => {} },
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

describe("pi-template-hook integration", () => {
	it("registers exactly tool_call and session_start handlers", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		expect(Array.from(handlers.keys()).sort()).toEqual(["session_start", "tool_call"]);
	});

	it("does not mutate bash commands without secrets", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const event: any = { toolName: "bash", input: { command: "ls -la" } };
		await (handlers.get("tool_call")![0] as any)(event, testContext());

		expect(event.input.command).toBe("ls -la");
	});

	it("redacts --token= in bash commands", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const event: any = { toolName: "bash", input: { command: "curl --token=abc123 https://example.com" } };
		await (handlers.get("tool_call")![0] as any)(event, testContext());

		expect(event.input.command).toBe("curl --token=<redacted> https://example.com");
	});

	it("ignores non-bash tool calls", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers, entries } = createRecordingMock();
		mod.default(api);

		const event: any = { toolName: "read", input: { path: "/etc/passwd" } };
		await (handlers.get("tool_call")![0] as any)(event, testContext());

		// Audit entry should NOT fire for non-bash tools
		expect(entries).toHaveLength(0);
	});

	it("appends an audit entry on every bash call", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers, entries } = createRecordingMock();
		mod.default(api);

		const event: any = { toolName: "bash", input: { command: "echo hi" } };
		await (handlers.get("tool_call")![0] as any)(event, testContext());

		expect(entries).toHaveLength(1);
		expect(entries[0].type).toBe("hook:bash-audit");
		expect((entries[0].data as any).command).toBe("echo hi");
		expect((entries[0].data as any).redacted).toBe(false);
		expect(typeof (entries[0].data as any).timestamp).toBe("string");
	});

	it("audit entry records redacted=true when a rule fires", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers, entries } = createRecordingMock();
		mod.default(api);

		const event: any = { toolName: "bash", input: { command: "curl --token=xyz https://api.example.com" } };
		await (handlers.get("tool_call")![0] as any)(event, testContext());

		expect(entries[0].type).toBe("hook:bash-audit");
		expect((entries[0].data as any).redacted).toBe(true);
		expect((entries[0].data as any).command).toBe("curl --token=<redacted> https://api.example.com");
	});

	it("session_start handler does not throw", async () => {
		const mod = await import("../src/index.js");
		const { api, handlers } = createRecordingMock();
		mod.default(api);

		const ss = handlers.get("session_start")![0] as any;
		await expect(ss({}, testContext())).resolves.not.toThrow();
	});
});
