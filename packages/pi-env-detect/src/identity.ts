import type { SystemAccess } from "./system.js";
import type { IdentityResult } from "./types.js";

/** Container marker files and the runtime each implies. */
const CONTAINER_MARKERS: Array<[path: string, runtime: string]> = [
	["/.dockerenv", "docker"],
	["/run/.containerenv", "podman"],
];

/** Detect a container runtime from marker files, env, then cgroup contents. */
function detectContainer(sys: SystemAccess, sources: string[]): string | undefined {
	for (const [path, runtime] of CONTAINER_MARKERS) {
		if (sys.exists(path)) {
			sources.push(path);
			return runtime;
		}
	}
	const containerEnv = sys.env("container");
	if (containerEnv) {
		sources.push("env:container");
		return containerEnv;
	}
	const cgroup = sys.readFile("/proc/1/cgroup") ?? sys.readFile("/proc/self/cgroup");
	if (cgroup) {
		if (/kubepods|docker/.test(cgroup)) {
			sources.push("cgroup");
			return "docker";
		}
		if (/lxc/.test(cgroup)) {
			sources.push("cgroup");
			return "lxc";
		}
	}
	return undefined;
}

/** Detect a hypervisor/VM vendor from systemd-detect-virt, then DMI, then cpuinfo. */
function detectHypervisor(sys: SystemAccess, sources: string[]): string | undefined {
	const out = sys.exec("systemd-detect-virt", [])?.trim();
	if (out) {
		sources.push("systemd-detect-virt");
		if (out !== "none") {
			// systemd-detect-virt reports container types too; ignore those here.
			if (!["docker", "podman", "lxc", "lxc-libvirt", "systemd-nspawn"].includes(out)) {
				return out;
			}
		}
	}
	const vendor = (sys.readFile("/sys/class/dmi/id/sys_vendor") ?? "").trim().toLowerCase();
	const dmiMap: Array<[needle: string, name: string]> = [
		["qemu", "qemu"],
		["amazon", "amazon"],
		["google", "google"],
		["microsoft", "hyperv"],
		["vmware", "vmware"],
		["innotek", "virtualbox"],
		["xen", "xen"],
	];
	for (const [needle, name] of dmiMap) {
		if (vendor.includes(needle)) {
			sources.push("dmi:sys_vendor");
			return name;
		}
	}
	const cpuinfo = sys.readFile("/proc/cpuinfo") ?? "";
	if (/\bhypervisor\b/.test(cpuinfo)) {
		sources.push("cpuinfo:hypervisor");
		return "unknown-hypervisor";
	}
	return undefined;
}

export function probeIdentity(sys: SystemAccess): IdentityResult {
	const sources: string[] = [];
	const container = detectContainer(sys, sources);
	const hypervisor = detectHypervisor(sys, sources);
	const k8s = sys.env("KUBERNETES_SERVICE_HOST") !== undefined || sys.exists("/var/run/secrets/kubernetes.io");
	if (k8s) sources.push("k8s");

	const layers: string[] = [];
	if (hypervisor) layers.push(hypervisor);
	if (container) layers.push(container);

	let type: IdentityResult["type"];
	if (container && hypervisor) type = "nested";
	else if (container) type = "container";
	else if (hypervisor) type = "vm";
	else if (sources.length > 0 || sys.readFile("/proc/cpuinfo")) type = "baremetal";
	else type = "unknown";

	return { type, hypervisor, container, layers, k8s, sources };
}
