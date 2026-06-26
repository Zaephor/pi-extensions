import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

describe("pi-env-detect package shape", () => {
	it("is published as a pi-package", () => {
		expect(pkg.name).toBe("pi-env-detect");
		expect(pkg.keywords).toContain("pi-package");
		expect(pkg.pi.extensions).toContain("./src/index.ts");
	});

	it("declares pi peer deps (version-agnostic via '*')", () => {
		for (const dep of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]) {
			expect(pkg.peerDependencies?.[dep]).toBeDefined();
		}
	});
});
