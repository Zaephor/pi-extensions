import type { SystemAccess } from "./system.js";
import type { ToolingResult, ToolPresence } from "./types.js";

/**
 * Fixed allowlist of spawn-relevant tools. Each entry maps a ToolingResult key
 * to the candidate binary names to look for on PATH. This is the ONLY set of
 * binaries the tooling probe ever queries — no general PATH inventory.
 */
export const TOOL_ALLOWLIST: Array<{ key: keyof ToolingResult; bins: string[] }> = [
	{ key: "docker", bins: ["docker"] },
	{ key: "podman", bins: ["podman"] },
	{ key: "qemu", bins: ["qemu-system-x86_64", "qemu-system-aarch64", "qemu-kvm"] },
	{ key: "libvirtd", bins: ["libvirtd"] },
	{ key: "virsh", bins: ["virsh"] },
	{ key: "lxc", bins: ["lxc"] },
	{ key: "lxd", bins: ["lxd"] },
	{ key: "kubectl", bins: ["kubectl"] },
	{ key: "vagrant", bins: ["vagrant"] },
	{ key: "nspawn", bins: ["systemd-nspawn"] },
];

export function probeTooling(sys: SystemAccess): ToolingResult {
	const out = {} as ToolingResult;
	for (const { key, bins } of TOOL_ALLOWLIST) {
		const path = sys.which(bins);
		const presence: ToolPresence = path ? { present: true, path } : { present: false };
		out[key] = presence;
	}
	return out;
}
