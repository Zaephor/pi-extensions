import type { SystemAccess } from "./system.js";
import type { IdentityResult } from "./types.js";

/** Neutralize externally-sourced labels before they reach the system prompt:
 * strip control chars (newlines etc.), collapse whitespace, cap length. */
function sanitizeLabel(raw: string): string {
	return raw
		.replace(/[\x00-\x1f\x7f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 32);
}

/** Container marker files and the runtime each implies. */
const CONTAINER_MARKERS: Array<[path: string, runtime: string]> = [
	["/.dockerenv", "docker"],
	["/run/.containerenv", "podman"],
];

/**
 * Container type names reported by systemd-detect-virt.
 * Used to (a) exclude them from hypervisor detection and
 * (b) attribute them as a container when marker/cgroup detection missed.
 */
const SYSTEMD_CONTAINER_TYPES = [
	"docker",
	"podman",
	"lxc",
	"lxc-libvirt",
	"systemd-nspawn",
	"openvz",
	"wsl",
	"rkt",
	"proot",
	"pouch",
	"container-other",
];

/** Detect a container runtime from marker files, env, cgroup, then systemd-detect-virt. */
function detectContainer(sys: SystemAccess, sources: string[], dvirt: string | undefined): string | undefined {
	for (const [path, runtime] of CONTAINER_MARKERS) {
		if (sys.exists(path)) {
			sources.push(path);
			return runtime;
		}
	}
	const containerEnv = sys.env("container");
	if (containerEnv) {
		sources.push("env:container");
		return sanitizeLabel(containerEnv);
	}
	const cgroup = sys.readFile("/proc/1/cgroup") ?? sys.readFile("/proc/self/cgroup");
	if (cgroup) {
		sources.push("cgroup");
		if (/libpod/.test(cgroup)) return "podman";
		if (/crio-/.test(cgroup)) return "crio";
		if (/cri-containerd|containerd/.test(cgroup)) return "containerd";
		if (/kubepods/.test(cgroup)) return "containerd"; // modern k8s default
		if (/docker/.test(cgroup)) return "docker";
		if (/lxc/.test(cgroup)) return "lxc";
		sources.pop(); // matched nothing — undo the source push
	}
	if (dvirt && SYSTEMD_CONTAINER_TYPES.includes(dvirt)) {
		sources.push("systemd-detect-virt");
		return sanitizeLabel(dvirt);
	}
	return undefined;
}

/** Detect a hypervisor/VM vendor from the pre-fetched dvirt value, then DMI, then cpuinfo. */
function detectHypervisor(sys: SystemAccess, sources: string[], dvirt: string | undefined): string | undefined {
	if (dvirt && dvirt !== "none") {
		// systemd-detect-virt reports container types too; ignore those here.
		if (!SYSTEMD_CONTAINER_TYPES.includes(dvirt)) {
			sources.push("systemd-detect-virt");
			return sanitizeLabel(dvirt);
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
		["oracle", "oracle"],
		["digitalocean", "kvm"],
		["alibaba", "alibaba"],
		["nutanix", "nutanix"],
		["openstack", "kvm"],
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

	// Exec systemd-detect-virt exactly once and thread the result into helpers.
	const dvirt = sys.exec("systemd-detect-virt", [])?.trim();

	const container = detectContainer(sys, sources, dvirt);
	const hypervisor = detectHypervisor(sys, sources, dvirt);
	const k8s = sys.env("KUBERNETES_SERVICE_HOST") !== undefined || sys.exists("/var/run/secrets/kubernetes.io");
	if (k8s) sources.push("k8s");

	// A clean "none" from systemd-detect-virt is positive evidence of baremetal.
	if (!container && !hypervisor && dvirt === "none") {
		sources.push("systemd-detect-virt");
	}

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
