import { describe, expect, it } from "vitest";
import { probeIdentity } from "../src/identity.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("probeIdentity", () => {
	it("reports baremetal when systemd-detect-virt says none", () => {
		const { sys } = makeFakeSystem({ exec: { "systemd-detect-virt": "none\n" } });
		const r = probeIdentity(sys);
		expect(r.type).toBe("baremetal");
		expect(r.hypervisor).toBeUndefined();
		expect(r.container).toBeUndefined();
	});

	it("detects a plain KVM VM via systemd-detect-virt", () => {
		const { sys } = makeFakeSystem({ exec: { "systemd-detect-virt": "kvm\n" } });
		const r = probeIdentity(sys);
		expect(r.type).toBe("vm");
		expect(r.hypervisor).toBe("kvm");
		expect(r.layers).toEqual(["kvm"]);
	});

	it("detects a docker container via /.dockerenv", () => {
		const { sys } = makeFakeSystem({ exists: ["/.dockerenv"] });
		const r = probeIdentity(sys);
		expect(r.type).toBe("container");
		expect(r.container).toBe("docker");
	});

	it("detects podman via /run/.containerenv", () => {
		const { sys } = makeFakeSystem({ exists: ["/run/.containerenv"] });
		const r = probeIdentity(sys);
		expect(r.container).toBe("podman");
	});

	it("reports nested when a container sits under a hypervisor", () => {
		const { sys } = makeFakeSystem({
			exists: ["/.dockerenv"],
			files: { "/proc/cpuinfo": "flags : fpu hypervisor lm\n" },
			exec: { "systemd-detect-virt": "kvm\n" },
		});
		const r = probeIdentity(sys);
		expect(r.type).toBe("nested");
		expect(r.layers).toEqual(["kvm", "docker"]);
	});

	it("flags kubernetes from the service-host env var", () => {
		const { sys } = makeFakeSystem({
			exists: ["/.dockerenv"],
			env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" },
		});
		expect(probeIdentity(sys).k8s).toBe(true);
	});

	it("falls back to cgroup inspection when no dockerenv exists", () => {
		const { sys } = makeFakeSystem({
			files: { "/proc/1/cgroup": "0::/kubepods/burstable/pod123/abc\n" },
		});
		const r = probeIdentity(sys);
		expect(r.type).toBe("container");
	});
});
