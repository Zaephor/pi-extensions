import { describe, expect, it } from "vitest";
import { probeCapability } from "../src/capability.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("probeCapability", () => {
	it("detects hardware virt from vmx in cpuinfo flags", () => {
		const { sys } = makeFakeSystem({
			files: { "/proc/cpuinfo": "flags : fpu vme vmx lm\n" },
		});
		expect(probeCapability(sys).hwVirt).toBe(true);
	});

	it("detects svm (AMD) too", () => {
		const { sys } = makeFakeSystem({
			files: { "/proc/cpuinfo": "flags : fpu svm lm\n" },
		});
		expect(probeCapability(sys).hwVirt).toBe(true);
	});

	it("reports kvm true only when /dev/kvm is accessible", () => {
		const present = makeFakeSystem({ exists: ["/dev/kvm"], accessible: ["/dev/kvm"] });
		expect(probeCapability(present.sys).kvm).toBe(true);
		const inaccessible = makeFakeSystem({ exists: ["/dev/kvm"] });
		expect(probeCapability(inaccessible.sys).kvm).toBe(false);
	});

	it("detects nested virt from the kvm_intel module param", () => {
		const { sys } = makeFakeSystem({
			files: { "/sys/module/kvm_intel/parameters/nested": "Y\n" },
		});
		expect(probeCapability(sys).nestedVirt).toBe(true);
	});

	it("detects docker and podman sockets independently", () => {
		const { sys } = makeFakeSystem({ exists: ["/var/run/docker.sock"] });
		const r = probeCapability(sys);
		expect(r.dockerSocket).toBe(true);
		expect(r.podmanSocket).toBe(false);
	});

	it("detects a rootless podman socket via XDG_RUNTIME_DIR", () => {
		const { sys } = makeFakeSystem({
			env: { XDG_RUNTIME_DIR: "/run/user/1000" },
			exists: ["/run/user/1000/podman/podman.sock"],
		});
		expect(probeCapability(sys).podmanSocket).toBe(true);
	});

	it("parses CAP_SYS_ADMIN out of CapEff", () => {
		// bit 21 set => 0x...200000
		const { sys } = makeFakeSystem({
			files: { "/proc/self/status": "Name:\tsh\nCapEff:\t0000000000200000\nSeccomp:\t0\n" },
		});
		const r = probeCapability(sys);
		expect(r.caps).toContain("CAP_SYS_ADMIN");
	});

	it("flags seccomp confinement and uid0", () => {
		const { sys } = makeFakeSystem({
			euid: 0,
			files: { "/proc/self/status": "CapEff:\t0000000000000000\nSeccomp:\t2\n" },
		});
		const r = probeCapability(sys);
		expect(r.uid0).toBe(true);
		expect(r.seccomp).toBe(true);
	});
});
