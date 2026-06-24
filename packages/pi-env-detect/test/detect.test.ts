import { beforeEach, describe, expect, it } from "vitest";
import { detect, resetCache } from "../src/detect.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("detect", () => {
	beforeEach(() => resetCache());

	it("always returns identity + capability", () => {
		const { sys } = makeFakeSystem({ exec: { "systemd-detect-virt": "kvm\n" } });
		const r = detect(sys, "identity");
		expect(r.identity.type).toBe("vm");
		expect(r.capability).toBeDefined();
		expect(r.tooling).toBeUndefined();
	});

	it("includes tooling only for tooling/all scopes", () => {
		const { sys } = makeFakeSystem({ which: { docker: "/usr/bin/docker" } });
		expect(detect(sys, "capability").tooling).toBeUndefined();
		resetCache();
		expect(detect(sys, "all").tooling?.docker.present).toBe(true);
	});

	it("probes the host once and caches identity/capability across calls", () => {
		const { sys, calls } = makeFakeSystem({ files: { "/proc/cpuinfo": "flags : vmx\n" } });
		detect(sys, "identity");
		const after = calls.readFile;
		detect(sys, "capability");
		expect(calls.readFile).toBe(after); // no re-probe
	});

	it("lazily probes tooling once and merges it into the cache", () => {
		const { sys, calls } = makeFakeSystem({ which: { podman: "/usr/bin/podman" } });
		detect(sys, "identity");
		expect(calls.which).toBe(0); // tooling not touched yet
		detect(sys, "all");
		expect(calls.which).toBeGreaterThan(0);
		const before = calls.which;
		detect(sys, "tooling");
		expect(calls.which).toBe(before); // tooling cached
	});
});
