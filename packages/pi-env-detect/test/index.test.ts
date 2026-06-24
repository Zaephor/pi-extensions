import { describe, expect, it } from "vitest";

describe("pi-env-detect", () => {
	it("should export a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});
});
