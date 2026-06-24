/** Detection scopes. "all" includes tooling; identity+capability are the injected pair. */
export type Scope = "identity" | "capability" | "tooling" | "all";

export interface IdentityResult {
	/** Coarse classification. "nested" = a container running under a hypervisor/VM. */
	type: "baremetal" | "vm" | "container" | "nested" | "unknown";
	/** Hypervisor/VM vendor when under one, e.g. "kvm", "vmware", "amazon". */
	hypervisor?: string;
	/** Container runtime when inside one, e.g. "docker", "podman", "lxc". */
	container?: string;
	/** Ordered outer→inner layering, e.g. ["kvm", "docker"]. */
	layers: string[];
	/** Running inside Kubernetes. */
	k8s: boolean;
	/** Which signals fired, for transparency in the summary. */
	sources: string[];
}

export interface CapabilityResult {
	/** vmx (Intel) or svm (AMD) present in /proc/cpuinfo flags. */
	hwVirt: boolean;
	/** /dev/kvm exists and is accessible. */
	kvm: boolean;
	/** Nested virt enabled in the kvm_intel/kvm_amd module. */
	nestedVirt: boolean;
	/** A docker daemon socket / DOCKER_HOST is reachable-looking. */
	dockerSocket: boolean;
	/** A podman socket (root or rootless) / CONTAINER_HOST is present. */
	podmanSocket: boolean;
	/** Effective uid is 0. */
	uid0: boolean;
	/** Notable effective capabilities from /proc/self/status CapEff. */
	caps: string[];
	/** Process appears seccomp-confined. */
	seccomp: boolean;
}

export interface ToolPresence {
	present: boolean;
	path?: string;
}

export interface ToolingResult {
	docker: ToolPresence;
	podman: ToolPresence;
	qemu: ToolPresence;
	libvirtd: ToolPresence;
	virsh: ToolPresence;
	lxc: ToolPresence;
	lxd: ToolPresence;
	kubectl: ToolPresence;
	vagrant: ToolPresence;
	nspawn: ToolPresence;
}

export interface EnvReport {
	identity: IdentityResult;
	capability: CapabilityResult;
	/** Present only when a probed scope included tooling. */
	tooling?: ToolingResult;
}
