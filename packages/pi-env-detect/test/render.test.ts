import { describe, expect, it } from "vitest";
import { renderInjection, renderSummary } from "../src/render.js";
import type { EnvReport } from "../src/types.js";

const nestedKvm: EnvReport = {
	identity: {
		type: "nested",
		hypervisor: "kvm",
		container: "docker",
		layers: ["kvm", "docker"],
		k8s: false,
		sources: ["/.dockerenv", "systemd-detect-virt"],
	},
	capability: {
		hwVirt: true,
		kvm: true,
		nestedVirt: true,
		dockerSocket: false,
		podmanSocket: true,
		uid0: false,
		caps: ["CAP_SYS_ADMIN"],
		seccomp: true,
	},
};

describe("renderSummary", () => {
	it("describes the layering and the spawn-relevant capabilities", () => {
		const s = renderSummary(nestedKvm);
		expect(s).toMatch(/docker container.*kvm/i);
		expect(s).toMatch(/nested/i);
		expect(s).toMatch(/\/dev\/kvm/);
		expect(s).toMatch(/podman socket/i);
	});

	it("includes tooling when present", () => {
		const withTooling: EnvReport = {
			...nestedKvm,
			tooling: {
				docker: { present: false },
				podman: { present: true, path: "/usr/bin/podman" },
				qemu: { present: true, path: "/usr/bin/qemu-system-x86_64" },
				libvirtd: { present: false },
				virsh: { present: false },
				lxc: { present: false },
				lxd: { present: false },
				kubectl: { present: false },
				vagrant: { present: false },
				nspawn: { present: false },
			},
		};
		expect(renderSummary(withTooling)).toMatch(/podman.*qemu|qemu.*podman/i);
	});
});

describe("renderInjection", () => {
	it("never mentions tooling even when present", () => {
		const withTooling = { ...nestedKvm, tooling: undefined };
		const s = renderInjection(withTooling);
		expect(s).toMatch(/environment/i);
		expect(s.toLowerCase()).not.toContain("qemu");
	});

	it("renders a baremetal host plainly", () => {
		const bare: EnvReport = {
			identity: { type: "baremetal", layers: [], k8s: false, sources: ["cpuinfo:hypervisor"] },
			capability: {
				hwVirt: true,
				kvm: true,
				nestedVirt: false,
				dockerSocket: false,
				podmanSocket: false,
				uid0: true,
				caps: [],
				seccomp: false,
			},
		};
		expect(renderInjection(bare)).toMatch(/bare ?metal/i);
	});

	it("states container-launch capability when a socket is present", () => {
		const report = {
			identity: { type: "container", container: "docker", layers: ["docker"], k8s: false, sources: [] },
			capability: {
				hwVirt: false,
				kvm: false,
				nestedVirt: false,
				dockerSocket: true,
				podmanSocket: false,
				uid0: false,
				caps: [],
				seccomp: false,
			},
		} as any;
		expect(renderInjection(report)).toMatch(/launch containers/i);
	});

	it("renders seccomp as a restriction caveat, not a privilege", () => {
		const report = {
			identity: { type: "baremetal", layers: [], k8s: false, sources: [] },
			capability: {
				hwVirt: false,
				kvm: false,
				nestedVirt: false,
				dockerSocket: false,
				podmanSocket: false,
				uid0: false,
				caps: [],
				seccomp: true,
			},
		} as any;
		const s = renderInjection(report);
		expect(s).toMatch(/seccomp/i);
		expect(s).not.toMatch(/Privilege:[^\n]*seccomp/i); // seccomp not inside the Privilege clause
	});
});
