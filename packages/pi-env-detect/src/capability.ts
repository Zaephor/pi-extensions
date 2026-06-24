import type { SystemAccess } from "./system.js";
import type { CapabilityResult } from "./types.js";

/** Linux capability bit positions we care about for spawning workloads. */
const CAP_BITS: Array<[bit: bigint, name: string]> = [
	[21n, "CAP_SYS_ADMIN"],
	[12n, "CAP_NET_ADMIN"],
	[19n, "CAP_SYS_PTRACE"],
	[7n, "CAP_SETUID"],
];

function cpuHasVirt(sys: SystemAccess): boolean {
	const cpuinfo = sys.readFile("/proc/cpuinfo") ?? "";
	return /\b(vmx|svm)\b/.test(cpuinfo);
}

function kvmUsable(sys: SystemAccess): boolean {
	return sys.exists("/dev/kvm") && sys.access("/dev/kvm");
}

function nestedEnabled(sys: SystemAccess): boolean {
	for (const path of ["/sys/module/kvm_intel/parameters/nested", "/sys/module/kvm_amd/parameters/nested"]) {
		const v = sys.readFile(path)?.trim();
		if (v === "Y" || v === "1") return true;
	}
	return false;
}

function podmanSocket(sys: SystemAccess): boolean {
	if (sys.exists("/run/podman/podman.sock")) return true;
	if (sys.env("CONTAINER_HOST")) return true;
	const xdg = sys.env("XDG_RUNTIME_DIR");
	if (xdg && sys.exists(`${xdg}/podman/podman.sock`)) return true;
	return false;
}

function parseStatus(sys: SystemAccess): { caps: string[]; seccomp: boolean } {
	const status = sys.readFile("/proc/self/status") ?? "";
	const caps: string[] = [];
	const capMatch = status.match(/^CapEff:\s*([0-9a-fA-F]+)/m);
	if (capMatch) {
		const mask = BigInt(`0x${capMatch[1]}`);
		for (const [bit, name] of CAP_BITS) {
			if ((mask >> bit) & 1n) caps.push(name);
		}
	}
	const seccompMatch = status.match(/^Seccomp:\s*(\d+)/m);
	const seccomp = seccompMatch ? seccompMatch[1] !== "0" : false;
	return { caps, seccomp };
}

export function probeCapability(sys: SystemAccess): CapabilityResult {
	const { caps, seccomp } = parseStatus(sys);
	return {
		hwVirt: cpuHasVirt(sys),
		kvm: kvmUsable(sys),
		nestedVirt: nestedEnabled(sys),
		dockerSocket: sys.exists("/var/run/docker.sock") || sys.env("DOCKER_HOST") !== undefined,
		podmanSocket: podmanSocket(sys),
		uid0: sys.euid() === 0,
		caps,
		seccomp,
	};
}
