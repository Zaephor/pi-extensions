import type { CapabilityResult, EnvReport, IdentityResult, ToolingResult } from "./types.js";

function identitySentence(id: IdentityResult): string {
	switch (id.type) {
		case "baremetal":
			return "Running on baremetal (no hypervisor or container detected).";
		case "vm":
			return `Running in a ${id.hypervisor ?? "virtual"} VM.`;
		case "container":
			return `Running in a ${id.container ?? "unknown"} container.`;
		case "nested":
			return `Running in a ${id.container} container on a ${id.hypervisor} VM (nested).`;
		default:
			return "Environment could not be determined.";
	}
}

function capabilitySentences(cap: CapabilityResult): string[] {
	const out: string[] = [];
	if (cap.kvm && cap.nestedVirt) out.push("`/dev/kvm` is accessible and nested virt is enabled — you can launch VMs.");
	else if (cap.kvm) out.push("`/dev/kvm` is accessible — you can launch VMs.");
	else if (cap.hwVirt) out.push("CPU virt extensions are present but `/dev/kvm` is not accessible.");
	else out.push("No usable hardware virtualization detected.");

	if (cap.dockerSocket || cap.podmanSocket) {
		const which = [cap.dockerSocket && "docker", cap.podmanSocket && "podman"].filter(Boolean).join(" and ");
		out.push(`A ${which} socket is present — you can launch containers.`);
	} else {
		out.push("No container runtime socket detected.");
	}

	const priv: string[] = [];
	if (cap.uid0) priv.push("uid 0");
	if (cap.caps.length) priv.push(cap.caps.join(", "));
	if (priv.length) out.push(`Privilege: ${priv.join("; ")}.`);
	if (cap.seccomp) out.push("Note: the process is seccomp-confined, which may restrict some spawn-related syscalls.");
	return out;
}

function toolingSentence(t: ToolingResult): string {
	const present = (Object.entries(t) as Array<[string, { present: boolean }]>)
		.filter(([, v]) => v.present)
		.map(([k]) => k);
	return present.length
		? `Spawn tooling on PATH: ${present.join(", ")}.`
		: "No spawn tooling (docker/podman/qemu/etc.) found on PATH.";
}

/** Compact identity+capability block for the system-prompt injection. Never includes tooling. */
export function renderInjection(report: EnvReport): string {
	const lines = ["Detected execution environment:", `- ${identitySentence(report.identity)}`];
	for (const s of capabilitySentences(report.capability)) lines.push(`- ${s}`);
	lines.push("Use the `detect_environment` tool for tooling details or a fresh probe.");
	return lines.join("\n");
}

/** Full prose including tooling when it was probed. Used as the tool's text content. */
export function renderSummary(report: EnvReport): string {
	const lines = [identitySentence(report.identity), ...capabilitySentences(report.capability)];
	if (report.identity.k8s) lines.push("Inside a Kubernetes pod.");
	if (report.tooling) lines.push(toolingSentence(report.tooling));
	return lines.join(" ");
}
