import { describe, expect, it } from "vitest";

describe("pi-template-stateful", () => {
	it("should export a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});
});
