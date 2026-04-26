import { describe, expect, it, vi } from "vitest";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

describe("pi-template extension", () => {
	it("should export a factory function as default", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});

	describe("tool registration", () => {
		it("registers exactly one tool", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools).toHaveLength(1);
		});

		it("registers the hello tool with correct name and label", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const tool = tools[0].tool;
			expect(tool.name).toBe("hello");
			expect(tool.label).toBe("Hello");
		});

		it("has a non-empty description", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools[0].tool.description.length).toBeGreaterThan(0);
		});

		it("tool execute returns greeting with the provided name", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const result = await tools[0].tool.execute("tc1", { name: "World" }, undefined, undefined, createMockContext() as any);
			expect(result.content).toEqual([{ type: "text", text: "Hello, World!" }]);
			expect(result.details).toEqual({});
		});

		it("tool execute works with arbitrary names", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const result = await tools[0].tool.execute("tc1", { name: "Alice" }, undefined, undefined, createMockContext() as any);
			expect(result.content[0].text).toBe("Hello, Alice!");
		});
	});

	describe("command registration", () => {
		it("registers exactly one command", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);
			expect(commands).toHaveLength(1);
		});

		it("registers the greet command", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);
			expect(commands[0].name).toBe("greet");
		});

		it("command has a description", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);
			expect(commands[0].description).toBeTruthy();
		});

		it("command handler notifies with the provided name", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);
			const notify = vi.fn();
			const ctx = createMockContext({ notify });
			await commands[0].handler("Alice", ctx as any);
			expect(notify).toHaveBeenCalledWith("Hello, Alice! 👋", "info");
		});

		it("command handler defaults to 'world' when no args given", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);
			const notify = vi.fn();
			const ctx = createMockContext({ notify });
			await commands[0].handler("  ", ctx as any);
			expect(notify).toHaveBeenCalledWith("Hello, world! 👋", "info");
		});
	});

	describe("event registration", () => {
		it("registers exactly one event handler", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			expect(events).toHaveLength(1);
		});

		it("subscribes to session_start", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			expect(events[0].event).toBe("session_start");
		});

		it("session_start handler notifies that extension loaded", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			const notify = vi.fn();
			const ctx = createMockContext({ notify });
			await events[0].handler({}, ctx as any);
			expect(notify).toHaveBeenCalledWith("pi-template extension loaded ✅", "info");
		});
	});
});
