import { describe, expect, it } from "vitest";
import { probeTooling, TOOL_ALLOWLIST } from "../src/tooling.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("probeTooling", () => {
	it("reports docker present with its resolved path", () => {
		const { sys } = makeFakeSystem({ which: { docker: "/usr/bin/docker" } });
		const r = probeTooling(sys);
		expect(r.docker).toEqual({ present: true, path: "/usr/bin/docker" });
		expect(r.podman.present).toBe(false);
	});

	it("resolves qemu through any arch-specific binary name", () => {
		const { sys } = makeFakeSystem({ which: { "qemu-system-aarch64": "/usr/bin/qemu-system-aarch64" } });
		expect(probeTooling(sys).qemu.present).toBe(true);
	});

	it("reports everything absent on a bare host", () => {
		const { sys } = makeFakeSystem({});
		const r = probeTooling(sys);
		for (const key of Object.keys(r) as Array<keyof typeof r>) {
			expect(r[key].present).toBe(false);
		}
	});

	it("only ever queries allowlisted binaries", () => {
		const queried: string[] = [];
		const sys = {
			readFile: () => undefined,
			exists: () => false,
			access: () => false,
			env: () => undefined,
			euid: () => undefined,
			exec: () => undefined,
			which: (bins: string[]) => {
				queried.push(...bins);
				return undefined;
			},
		};
		probeTooling(sys);
		const flat = new Set(TOOL_ALLOWLIST.flatMap((t) => t.bins));
		for (const b of queried) expect(flat.has(b)).toBe(true);
	});
});
