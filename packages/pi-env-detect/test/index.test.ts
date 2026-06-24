import { describe, expect, it } from "vitest";
import factory from "../src/index.js";
import { createMockAPI } from "./helpers/mock-api.js";

describe("pi-env-detect wiring", () => {
	it("registers the detect_environment tool with a prompt snippet", () => {
		const { api, tools } = createMockAPI();
		factory(api);
		const tool = tools.find((t) => t.name === "detect_environment");
		expect(tool).toBeDefined();
		expect(tool?.promptSnippet).toBeTruthy();
	});

	it("injects an identity+capability block via before_agent_start by default", async () => {
		const { api, events } = createMockAPI({ "--env-detect": "inject" });
		factory(api);
		const handler = events.get("before_agent_start");
		expect(handler).toBeDefined();
		const result = (await handler?.(
			{ type: "before_agent_start", prompt: "hi", systemPrompt: "BASE" } as any,
			{} as any,
		)) as { systemPrompt?: string } | undefined;
		expect(result?.systemPrompt).toContain("BASE");
		expect(result?.systemPrompt).toMatch(/execution environment/i);
	});

	it("suppresses injection when --env-detect=disabled", async () => {
		const { api, events } = createMockAPI({ "--env-detect": "disabled" });
		factory(api);
		const handler = events.get("before_agent_start");
		const result = await handler?.(
			{ type: "before_agent_start", prompt: "hi", systemPrompt: "BASE" } as any,
			{} as any,
		);
		expect(result).toBeUndefined();
	});

	it("the tool returns prose content plus structured details", async () => {
		const { api, tools } = createMockAPI();
		factory(api);
		const tool = tools.find((t) => t.name === "detect_environment");
		const res: any = await tool?.execute("id1", { scope: "all" }, undefined, undefined, {} as any);
		expect(res.content[0].text).toBeTruthy();
		expect(res.details.identity).toBeDefined();
		expect(res.details.capability).toBeDefined();
	});
});
