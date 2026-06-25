import { describe, expect, it } from "vitest";
import { probeCapability } from "../src/capability.js";
import { detect, resetCache } from "../src/detect.js";
import { probeIdentity } from "../src/identity.js";
import { renderInjection, renderSummary } from "../src/render.js";
import { probeTooling } from "../src/tooling.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("never-throw invariant", () => {
	const cases = {
		empty: {},
		garbage: {
			files: {
				"/proc/cpuinfo": "@@@ not real",
				"/proc/self/status": "CapEff:\tZZZZ\nSeccomp:\t??\n",
				"/proc/1/cgroup": " garbage",
				"/sys/class/dmi/id/sys_vendor": "\n",
			},
			env: { container: "\n\nweird", DOCKER_HOST: "" },
			exec: { "systemd-detect-virt": " bogus\n" },
		},
	};
	for (const [name, spec] of Object.entries(cases)) {
		it(`degrades without throwing: ${name}`, () => {
			resetCache();
			const { sys } = makeFakeSystem(spec as any);
			expect(() => {
				const id = probeIdentity(sys);
				const cap = probeCapability(sys);
				probeTooling(sys);
				const report = detect(sys, "all");
				renderInjection(report);
				renderSummary(report);
				// shapes are still valid
				expect(typeof id.type).toBe("string");
				expect(Array.isArray(cap.caps)).toBe(true);
			}).not.toThrow();
		});
	}
});
