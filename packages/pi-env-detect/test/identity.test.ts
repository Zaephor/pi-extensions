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
		expect(r.container).toBe("containerd");
	});

	it("attributes rootless podman from a libpod cgroup scope", () => {
		const { sys } = makeFakeSystem({
			files: { "/proc/self/cgroup": "0::/user.slice/user-1000.slice/.../libpod-abc.scope\n" },
		});
		expect(probeIdentity(sys).container).toBe("podman");
	});

	it("attributes CRI-O from a crio cgroup scope", () => {
		const { sys } = makeFakeSystem({ files: { "/proc/1/cgroup": "0::/crio-abc123.scope\n" } });
		expect(probeIdentity(sys).container).toBe("crio");
	});

	it("attributes containerd from a cri-containerd cgroup scope", () => {
		const { sys } = makeFakeSystem({ files: { "/proc/1/cgroup": "0::/kubepods/.../cri-containerd-abc.scope\n" } });
		expect(probeIdentity(sys).container).toBe("containerd");
	});

	it("treats systemd-detect-virt openvz as a container, not a VM", () => {
		const { sys } = makeFakeSystem({ exec: { "systemd-detect-virt": "openvz\n" } });
		const r = probeIdentity(sys);
		expect(r.type).toBe("container");
		expect(r.container).toBe("openvz");
	});

	it("detects hyperv via DMI when systemd-detect-virt is absent", () => {
		const { sys } = makeFakeSystem({ files: { "/sys/class/dmi/id/sys_vendor": "Microsoft Corporation\n" } });
		const r = probeIdentity(sys);
		expect(r.type).toBe("vm");
		expect(r.hypervisor).toBe("hyperv");
	});

	it("detects DigitalOcean/Oracle via DMI", () => {
		expect(
			probeIdentity(makeFakeSystem({ files: { "/sys/class/dmi/id/sys_vendor": "DigitalOcean\n" } }).sys).type,
		).toBe("vm");
		expect(
			probeIdentity(makeFakeSystem({ files: { "/sys/class/dmi/id/sys_vendor": "Oracle Corporation\n" } }).sys)
				.hypervisor,
		).toBe("oracle");
	});

	it("detects container from the $container env var", () => {
		const { sys } = makeFakeSystem({ env: { container: "systemd-nspawn" } });
		expect(probeIdentity(sys).container).toBe("systemd-nspawn");
	});

	it("yields unknown for a completely opaque system without throwing", () => {
		const { sys } = makeFakeSystem({});
		let r: ReturnType<typeof probeIdentity> | undefined;
		expect(() => {
			r = probeIdentity(sys);
		}).not.toThrow();
		expect(r?.type).toBe("unknown");
	});
});
