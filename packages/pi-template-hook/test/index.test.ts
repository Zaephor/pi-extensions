import { describe, expect, it } from "vitest";

describe("pi-template-hook", () => {
	it("should export a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});

	it("should export the redact helper", async () => {
		const mod = await import("../src/index.js");
		expect(typeof (mod as any).redact).toBe("function");
	});
});
