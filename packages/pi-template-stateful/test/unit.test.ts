import { describe, expect, it } from "vitest";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

describe("pi-template-stateful", () => {
	it("exports a default factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});

	describe("counter tool", () => {
		it("registers exactly one tool, named counter", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools).toHaveLength(1);
			expect(tools[0].tool.name).toBe("counter");
		});

		it("increment increases the count and records it in details", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);

			const r1 = await tools[0].tool.execute(
				"tc1",
				{ action: "increment" },
				undefined,
				undefined,
				createMockContext() as any,
			);
			const r2 = await tools[0].tool.execute(
				"tc2",
				{ action: "increment" },
				undefined,
				undefined,
				createMockContext() as any,
			);

			expect((r1.details as any).count).toBe(1);
			expect((r2.details as any).count).toBe(2);
			expect((r2.details as any).action).toBe("increment");
		});

		it("decrement and reset work as expected", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const ctx = createMockContext() as any;

			await tools[0].tool.execute("tc1", { action: "increment" }, undefined, undefined, ctx);
			await tools[0].tool.execute("tc2", { action: "increment" }, undefined, undefined, ctx);
			const dec = await tools[0].tool.execute("tc3", { action: "decrement" }, undefined, undefined, ctx);
			expect((dec.details as any).count).toBe(1);

			const reset = await tools[0].tool.execute("tc4", { action: "reset" }, undefined, undefined, ctx);
			expect((reset.details as any).count).toBe(0);
		});

		it("get returns the current count without mutating", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const ctx = createMockContext() as any;

			await tools[0].tool.execute("tc1", { action: "increment" }, undefined, undefined, ctx);
			const get1 = await tools[0].tool.execute("tc2", { action: "get" }, undefined, undefined, ctx);
			const get2 = await tools[0].tool.execute("tc3", { action: "get" }, undefined, undefined, ctx);

			expect((get1.details as any).count).toBe(1);
			expect((get2.details as any).count).toBe(1);
		});
	});

	describe("/counter command", () => {
		it("registers exactly one command, named counter", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);
			expect(commands).toHaveLength(1);
			expect(commands[0].name).toBe("counter");
		});

		it("command notifies the current value", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string) => notified.push(msg) }) as any;
			await commands[0].handler("", ctx);
			expect(notified[0]).toMatch(/Counter: 0/);
		});
	});

	describe("session_start handler", () => {
		it("registers a session_start handler", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			expect(events.map((e) => e.event)).toContain("session_start");
		});

		it("reconstructs the count from session entries", async () => {
			const mod = await import("../src/index.js");
			const { api, events, commands } = createMockAPI();
			mod.default(api);

			const sessionStart = events.find((e) => e.event === "session_start")!;
			const entries = [
				{
					type: "tool_result",
					data: { toolName: "counter", details: { action: "increment", count: 1 } },
				},
				{
					type: "tool_result",
					data: { toolName: "counter", details: { action: "increment", count: 2 } },
				},
				{
					type: "tool_result",
					data: { toolName: "counter", details: { action: "increment", count: 3 } },
				},
			];

			const ctx = { ...createMockContext(), entries } as any;
			await sessionStart.handler({} as any, ctx);

			const notified: string[] = [];
			const ctx2 = createMockContext({ notify: (msg: string) => notified.push(msg) }) as any;
			await commands[0].handler("", ctx2);
			expect(notified[0]).toBe("Counter: 3");
		});

		it("ignores tool_result entries from other tools", async () => {
			const mod = await import("../src/index.js");
			const { api, events, commands } = createMockAPI();
			mod.default(api);

			const sessionStart = events.find((e) => e.event === "session_start")!;
			const entries = [
				{ type: "tool_result", data: { toolName: "other-tool", details: { count: 999 } } },
				{ type: "tool_result", data: { toolName: "counter", details: { action: "increment", count: 5 } } },
				{ type: "tool_result", data: { toolName: "yet-another", details: { count: 12345 } } },
			];

			const ctx = { ...createMockContext(), entries } as any;
			await sessionStart.handler({} as any, ctx);

			const notified: string[] = [];
			const ctx2 = createMockContext({ notify: (msg: string) => notified.push(msg) }) as any;
			await commands[0].handler("", ctx2);
			expect(notified[0]).toBe("Counter: 5");
		});

		it("defaults to 0 when there are no prior entries", async () => {
			const mod = await import("../src/index.js");
			const { api, events, commands } = createMockAPI();
			mod.default(api);

			const sessionStart = events.find((e) => e.event === "session_start")!;
			const ctx = { ...createMockContext(), entries: [] } as any;
			await sessionStart.handler({} as any, ctx);

			const notified: string[] = [];
			const ctx2 = createMockContext({ notify: (msg: string) => notified.push(msg) }) as any;
			await commands[0].handler("", ctx2);
			expect(notified[0]).toBe("Counter: 0");
		});
	});
});
