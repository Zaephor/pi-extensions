import { describe, expect, it, vi } from "vitest";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

describe("pi-co-author extension", () => {
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

		it("registers the pi-co-author tool with correct name and label", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const tool = tools[0].tool;
			expect(tool.name).toBe("pi-co-author");
			expect(tool.label).toBe("Pi-co-author");
		});

		it("has a non-empty description", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools[0].tool.description.length).toBeGreaterThan(0);
		});

		it("tool execute returns result", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const result = await tools[0].tool.execute("tc1", {}, undefined, undefined, createMockContext() as any);
			expect(result.content).toEqual([{ type: "text", text: "pi-co-author executed" }]);
			expect(result.details).toEqual({});
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
			expect(notify).toHaveBeenCalledWith("pi-co-author extension loaded ✅", "info");
		});
	});
});
