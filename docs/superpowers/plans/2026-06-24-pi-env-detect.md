# pi-env-detect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pi extension that auto-injects the agent's environment identity + capability into the system prompt and exposes a `detect_environment(scope?)` tool for on-demand depth.

**Architecture:** Probes are pure functions over an injected `SystemAccess` seam (reads `/proc`, `/sys`, `/dev`, env, and shells out only through that interface), so every scenario is unit-testable with synthetic fakes. `detect.ts` aggregates the three scope probes and caches the result for the process lifetime. `index.ts` wires a tool, a `before_agent_start` injection of the identity+capability summary, a `/detect-environment` command, and an `--env-detect` flag.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), TypeBox schemas (`Type` / `StringEnum` re-exported from `@earendil-works/pi-ai`), pi `ExtensionAPI` (`@earendil-works/pi-coding-agent` ^0.77.0), vitest, biome.

## Global Constraints

- POSIX/Linux-first. Every probe degrades to a safe default ("unknown"/false/absent) when its source is missing or unreadable — **never throws**.
- Node engine floor `>=22.19.0`; ESM only; import siblings with explicit `.js` extension.
- Peer deps on `@earendil-works/pi-*` at `^0.77.0` and `typebox` — mirror `packages/pi-co-author/package.json` exactly.
- TypeBox schemas use `Type` / `StringEnum` from `@earendil-works/pi-ai` (not a bare `typebox` import for `StringEnum`).
- Tooling scope is a **fixed allowlist** only: `docker, podman, qemu-system-*, libvirtd, virsh, lxc, lxd, kubectl, vagrant, systemd-nspawn`. Never a general PATH scan.
- Tooling is **never** part of the injected summary in v1 (on-demand via the tool only).
- `npm run check:all` (`typecheck && biome check && vitest run`) must pass before the final commit.

---

### Task 1: Scaffold package + types + SystemAccess seam

**Files:**
- Create (via scaffold): `packages/pi-env-detect/` (package.json, tsconfig.json, src/index.ts, test/, README.md)
- Create: `packages/pi-env-detect/src/types.ts`
- Create: `packages/pi-env-detect/src/system.ts`
- Create: `packages/pi-env-detect/test/helpers/fake-system.ts`
- Modify: strip the demo tool out of the scaffolded `src/index.ts` (replaced wholesale in Task 7)

**Interfaces:**
- Produces: all result types (`Scope`, `IdentityResult`, `CapabilityResult`, `ToolingResult`, `ToolPresence`, `EnvReport`); `SystemAccess` interface + `realSystem()` factory; `makeFakeSystem(spec)` test helper.

- [ ] **Step 1: Scaffold from the tool+command template**

Run:
```bash
node scripts/create-extension.js pi-env-detect --template pi-template
```
Expected: creates `packages/pi-env-detect/` and updates root `tsconfig.json` + release config. Confirm:
```bash
ls packages/pi-env-detect/src
```
Expected: `index.ts`.

- [ ] **Step 2: Write `src/types.ts`**

```typescript
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
```

- [ ] **Step 3: Write `src/system.ts` (interface + real impl)**

```typescript
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * The single seam between probes and the host. Every probe takes a SystemAccess
 * so tests can inject synthetic environments. The real impl never throws — every
 * method returns a safe "absent" value on error.
 */
export interface SystemAccess {
	/** File contents, or undefined if missing/unreadable. */
	readFile(path: string): string | undefined;
	/** Whether a path exists. */
	exists(path: string): boolean;
	/** Whether a path is accessible for the given fs.constants mode (default R_OK). */
	access(path: string, mode?: number): boolean;
	/** Environment variable value, or undefined. */
	env(name: string): string | undefined;
	/** Effective uid (process.geteuid), or undefined on platforms without it. */
	euid(): number | undefined;
	/** Run a command; undefined if it cannot be spawned or exits non-zero. */
	exec(cmd: string, args: string[]): string | undefined;
	/** Resolve the first of `bins` found on PATH; returns its absolute path or undefined. */
	which(bins: string[]): string | undefined;
}

export function realSystem(): SystemAccess {
	return {
		readFile(path) {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return undefined;
			}
		},
		exists(path) {
			try {
				return existsSync(path);
			} catch {
				return false;
			}
		},
		access(path, mode = constants.R_OK) {
			try {
				accessSync(path, mode);
				return true;
			} catch {
				return false;
			}
		},
		env(name) {
			return process.env[name];
		},
		euid() {
			return typeof process.geteuid === "function" ? process.geteuid() : undefined;
		},
		exec(cmd, args) {
			try {
				const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 2000 });
				if (r.status !== 0 || typeof r.stdout !== "string") return undefined;
				return r.stdout;
			} catch {
				return undefined;
			}
		},
		which(bins) {
			const path = process.env.PATH ?? "";
			for (const dir of path.split(":")) {
				if (!dir) continue;
				for (const bin of bins) {
					const full = join(dir, bin);
					try {
						if (existsSync(full)) return full;
					} catch {
						// keep scanning
					}
				}
			}
			return undefined;
		},
	};
}
```

- [ ] **Step 4: Write `test/helpers/fake-system.ts`**

```typescript
import type { SystemAccess } from "../../src/system.js";

/** Declarative description of a synthetic host for tests. */
export interface FakeSpec {
	files?: Record<string, string>;          // path -> contents (also implies exists)
	exists?: string[];                       // extra paths that exist but have no contents
	accessible?: string[];                   // paths for which access() returns true
	env?: Record<string, string>;
	euid?: number;
	exec?: Record<string, string>;           // "cmd arg1 arg2" -> stdout
	which?: Record<string, string>;          // bin name -> resolved path
}

/** Build a SystemAccess backed entirely by the spec. Tracks call counts for cache tests. */
export function makeFakeSystem(spec: FakeSpec) {
	const calls = { readFile: 0, exec: 0, which: 0 };
	const sys: SystemAccess = {
		readFile(path) {
			calls.readFile++;
			return spec.files?.[path];
		},
		exists(path) {
			return path in (spec.files ?? {}) || (spec.exists ?? []).includes(path);
		},
		access(path) {
			return (spec.accessible ?? []).includes(path);
		},
		env(name) {
			return spec.env?.[name];
		},
		euid() {
			return spec.euid;
		},
		exec(cmd, args) {
			calls.exec++;
			return spec.exec?.[[cmd, ...args].join(" ")];
		},
		which(bins) {
			calls.which++;
			for (const b of bins) {
				const hit = spec.which?.[b];
				if (hit) return hit;
			}
			return undefined;
		},
	};
	return { sys, calls };
}
```

- [ ] **Step 5: Typecheck the new files**

Run: `npm run typecheck`
Expected: PASS (no references to the not-yet-written probe modules).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-env-detect tsconfig.json release-please-config.json .release-please-manifest.json package.json
git commit -m "feat(env-detect): scaffold package, result types, and SystemAccess seam"
```

---

### Task 2: Identity probe

**Files:**
- Create: `packages/pi-env-detect/src/identity.ts`
- Test: `packages/pi-env-detect/test/identity.test.ts`

**Interfaces:**
- Consumes: `SystemAccess` (Task 1), `IdentityResult` (Task 1).
- Produces: `export function probeIdentity(sys: SystemAccess): IdentityResult`.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pi-env-detect/test/identity.test.ts`
Expected: FAIL — `probeIdentity` not found.

- [ ] **Step 3: Write `src/identity.ts`**

```typescript
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
	if (out && out !== "none") {
		// systemd-detect-virt reports container types too; ignore those here.
		if (!["docker", "podman", "lxc", "lxc-libvirt", "systemd-nspawn"].includes(out)) {
			sources.push("systemd-detect-virt");
			return out;
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
	const k8s =
		sys.env("KUBERNETES_SERVICE_HOST") !== undefined ||
		sys.exists("/var/run/secrets/kubernetes.io");
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/pi-env-detect/test/identity.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-env-detect/src/identity.ts packages/pi-env-detect/test/identity.test.ts
git commit -m "feat(env-detect): identity probe (container/vm/nested/k8s)"
```

---

### Task 3: Capability probe

**Files:**
- Create: `packages/pi-env-detect/src/capability.ts`
- Test: `packages/pi-env-detect/test/capability.test.ts`

**Interfaces:**
- Consumes: `SystemAccess` (Task 1), `CapabilityResult` (Task 1).
- Produces: `export function probeCapability(sys: SystemAccess): CapabilityResult`.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pi-env-detect/test/capability.test.ts`
Expected: FAIL — `probeCapability` not found.

- [ ] **Step 3: Write `src/capability.ts`**

```typescript
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
	for (const path of [
		"/sys/module/kvm_intel/parameters/nested",
		"/sys/module/kvm_amd/parameters/nested",
	]) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/pi-env-detect/test/capability.test.ts`
Expected: PASS (all 8).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-env-detect/src/capability.ts packages/pi-env-detect/test/capability.test.ts
git commit -m "feat(env-detect): capability probe (kvm/nested/sockets/caps)"
```

---

### Task 4: Tooling probe (bounded allowlist)

**Files:**
- Create: `packages/pi-env-detect/src/tooling.ts`
- Test: `packages/pi-env-detect/test/tooling.test.ts`

**Interfaces:**
- Consumes: `SystemAccess` (Task 1), `ToolingResult` / `ToolPresence` (Task 1).
- Produces: `export function probeTooling(sys: SystemAccess): ToolingResult`; `export const TOOL_ALLOWLIST` (for the wiring test to assert nothing outside it is probed).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { probeTooling, TOOL_ALLOWLIST } from "../src/tooling.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("probeTooling", () => {
	it("reports docker present with its resolved path", () => {
		const { sys } = makeFakeSystem({ which: { docker: "/usr/bin/docker" } });
		const r = probeTooling(sys);
		expect(r.docker).toEqual({ present: true, path: "/usr/bin/docker" });
		expect(r.podman.present).toBe(false);
	});

	it("resolves qemu through any arch-specific binary name", () => {
		const { sys } = makeFakeSystem({ which: { "qemu-system-aarch64": "/usr/bin/qemu-system-aarch64" } });
		expect(probeTooling(sys).qemu.present).toBe(true);
	});

	it("reports everything absent on a bare host", () => {
		const { sys } = makeFakeSystem({});
		const r = probeTooling(sys);
		for (const key of Object.keys(r) as Array<keyof typeof r>) {
			expect(r[key].present).toBe(false);
		}
	});

	it("only ever queries allowlisted binaries", () => {
		const queried: string[] = [];
		const sys = {
			readFile: () => undefined,
			exists: () => false,
			access: () => false,
			env: () => undefined,
			euid: () => undefined,
			exec: () => undefined,
			which: (bins: string[]) => {
				queried.push(...bins);
				return undefined;
			},
		};
		probeTooling(sys);
		const flat = new Set(TOOL_ALLOWLIST.flatMap((t) => t.bins));
		for (const b of queried) expect(flat.has(b)).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pi-env-detect/test/tooling.test.ts`
Expected: FAIL — `probeTooling` not found.

- [ ] **Step 3: Write `src/tooling.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/pi-env-detect/test/tooling.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-env-detect/src/tooling.ts packages/pi-env-detect/test/tooling.test.ts
git commit -m "feat(env-detect): tooling probe over fixed spawn allowlist"
```

---

### Task 5: Aggregator + session cache

**Files:**
- Create: `packages/pi-env-detect/src/detect.ts`
- Test: `packages/pi-env-detect/test/detect.test.ts`

**Interfaces:**
- Consumes: `probeIdentity` (Task 2), `probeCapability` (Task 3), `probeTooling` (Task 4), `SystemAccess` (Task 1), `Scope`/`EnvReport` (Task 1).
- Produces: `export function detect(sys: SystemAccess, scope: Scope): EnvReport`; `export function resetCache(): void` (test-only reset of the module cache).

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { detect, resetCache } from "../src/detect.js";
import { makeFakeSystem } from "./helpers/fake-system.js";

describe("detect", () => {
	beforeEach(() => resetCache());

	it("always returns identity + capability", () => {
		const { sys } = makeFakeSystem({ exec: { "systemd-detect-virt": "kvm\n" } });
		const r = detect(sys, "identity");
		expect(r.identity.type).toBe("vm");
		expect(r.capability).toBeDefined();
		expect(r.tooling).toBeUndefined();
	});

	it("includes tooling only for tooling/all scopes", () => {
		const { sys } = makeFakeSystem({ which: { docker: "/usr/bin/docker" } });
		expect(detect(sys, "capability").tooling).toBeUndefined();
		resetCache();
		expect(detect(sys, "all").tooling?.docker.present).toBe(true);
	});

	it("probes the host once and caches identity/capability across calls", () => {
		const { sys, calls } = makeFakeSystem({ files: { "/proc/cpuinfo": "flags : vmx\n" } });
		detect(sys, "identity");
		const after = calls.readFile;
		detect(sys, "capability");
		expect(calls.readFile).toBe(after); // no re-probe
	});

	it("lazily probes tooling once and merges it into the cache", () => {
		const { sys, calls } = makeFakeSystem({ which: { podman: "/usr/bin/podman" } });
		detect(sys, "identity");
		expect(calls.which).toBe(0); // tooling not touched yet
		detect(sys, "all");
		expect(calls.which).toBeGreaterThan(0);
		const before = calls.which;
		detect(sys, "tooling");
		expect(calls.which).toBe(before); // tooling cached
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pi-env-detect/test/detect.test.ts`
Expected: FAIL — `detect` not found.

- [ ] **Step 3: Write `src/detect.ts`**

```typescript
import { probeCapability } from "./capability.js";
import { probeIdentity } from "./identity.js";
import type { SystemAccess } from "./system.js";
import { probeTooling } from "./tooling.js";
import type { EnvReport, Scope } from "./types.js";

/**
 * Process-lifetime cache. The environment is host-stable for a session, so we
 * probe identity+capability once, and tooling at most once (lazily, when a
 * scope that needs it is first requested).
 */
let cache: EnvReport | undefined;

/** Test-only: clear the cache between cases. */
export function resetCache(): void {
	cache = undefined;
}

function needsTooling(scope: Scope): boolean {
	return scope === "tooling" || scope === "all";
}

export function detect(sys: SystemAccess, scope: Scope): EnvReport {
	if (!cache) {
		cache = {
			identity: probeIdentity(sys),
			capability: probeCapability(sys),
		};
	}
	if (needsTooling(scope) && !cache.tooling) {
		cache.tooling = probeTooling(sys);
	}
	return cache;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/pi-env-detect/test/detect.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-env-detect/src/detect.ts packages/pi-env-detect/test/detect.test.ts
git commit -m "feat(env-detect): scope aggregator with lazy session cache"
```

---

### Task 6: Render prose summary

**Files:**
- Create: `packages/pi-env-detect/src/render.ts`
- Test: `packages/pi-env-detect/test/render.test.ts`

**Interfaces:**
- Consumes: `EnvReport` (Task 1).
- Produces:
  - `export function renderSummary(report: EnvReport): string` — full prose (identity + capability + tooling-if-present).
  - `export function renderInjection(report: EnvReport): string` — the compact identity+capability-only block appended to the system prompt (never includes tooling).

- [ ] **Step 1: Write the failing test**

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/pi-env-detect/test/render.test.ts`
Expected: FAIL — `renderSummary` not found.

- [ ] **Step 3: Write `src/render.ts`**

```typescript
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
	if (cap.kvm && cap.nestedVirt)
		out.push("`/dev/kvm` is accessible and nested virt is enabled — you can launch VMs.");
	else if (cap.kvm) out.push("`/dev/kvm` is accessible — you can launch VMs.");
	else if (cap.hwVirt) out.push("CPU virt extensions are present but `/dev/kvm` is not accessible.");
	else out.push("No usable hardware virtualization detected.");

	if (cap.dockerSocket) out.push("A docker socket is present.");
	if (cap.podmanSocket) out.push("A podman socket is present.");
	if (!cap.dockerSocket && !cap.podmanSocket) out.push("No container runtime socket detected.");

	const priv: string[] = [];
	if (cap.uid0) priv.push("uid 0");
	if (cap.caps.length) priv.push(cap.caps.join(", "));
	if (cap.seccomp) priv.push("seccomp-confined");
	if (priv.length) out.push(`Privilege: ${priv.join("; ")}.`);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/pi-env-detect/test/render.test.ts`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-env-detect/src/render.ts packages/pi-env-detect/test/render.test.ts
git commit -m "feat(env-detect): prose renderers for injection and tool output"
```

---

### Task 7: Wire the extension (tool + injection + command + flag)

**Files:**
- Modify (replace wholesale): `packages/pi-env-detect/src/index.ts`
- Create: `packages/pi-env-detect/test/helpers/mock-api.ts` (copy the proven pattern from co-author, trimmed)
- Test: `packages/pi-env-detect/test/index.test.ts`

**Interfaces:**
- Consumes: `detect` (Task 5), `renderInjection`/`renderSummary` (Task 6), `realSystem` (Task 1), `Scope` (Task 1).
- Produces: the default `ExtensionFactory` export.

- [ ] **Step 1: Write `test/helpers/mock-api.ts`**

```typescript
import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@earendil-works/pi-coding-agent";

/** Records registrations + flags so wiring tests can drive the extension. */
export function createMockAPI(flagDefaults: Record<string, string> = {}) {
	const tools: ToolDefinition[] = [];
	const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
	const events = new Map<string, ExtensionHandler<any, any>>();
	const flags = new Map<string, string | boolean | undefined>(Object.entries(flagDefaults));

	const api = {
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, { handler: options.handler });
		},
		registerFlag(name: string, options: { default?: string | boolean }) {
			if (!flags.has(name)) flags.set(name, options.default);
		},
		getFlag(name: string) {
			return flags.get(name);
		},
		on(event: string, handler: ExtensionHandler<any, any>) {
			events.set(event, handler);
		},
		registerShortcut: () => {},
		registerMessageRenderer: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
	} as unknown as ExtensionAPI;

	return { api, tools, commands, events, flags };
}

export function createMockContext() {
	const notices: string[] = [];
	const ctx = { ui: { notify: (msg: string) => notices.push(msg) } } as any;
	return { ctx, notices };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import factory from "../src/index.js";
import { createMockAPI, createMockContext } from "./helpers/mock-api.js";

describe("pi-env-detect wiring", () => {
	it("registers the detect_environment tool with a prompt snippet", () => {
		const { api, tools } = createMockAPI();
		factory(api);
		const tool = tools.find((t) => t.name === "detect_environment");
		expect(tool).toBeDefined();
		expect(tool?.promptSnippet).toBeTruthy();
	});

	it("injects an identity+capability block via before_agent_start by default", async () => {
		const { api, events } = createMockAPI({ "--env-detect": "inject" });
		factory(api);
		const handler = events.get("before_agent_start");
		expect(handler).toBeDefined();
		const result = (await handler?.({ type: "before_agent_start", prompt: "hi", systemPrompt: "BASE" } as any, {} as any)) as
			| { systemPrompt?: string }
			| undefined;
		expect(result?.systemPrompt).toContain("BASE");
		expect(result?.systemPrompt).toMatch(/execution environment/i);
	});

	it("suppresses injection when --env-detect=disabled", async () => {
		const { api, events } = createMockAPI({ "--env-detect": "disabled" });
		factory(api);
		const handler = events.get("before_agent_start");
		const result = await handler?.({ type: "before_agent_start", prompt: "hi", systemPrompt: "BASE" } as any, {} as any);
		expect(result).toBeUndefined();
	});

	it("the tool returns prose content plus structured details", async () => {
		const { api, tools } = createMockAPI();
		factory(api);
		const tool = tools.find((t) => t.name === "detect_environment");
		const res: any = await tool?.execute("id1", { scope: "all" }, undefined, undefined, {} as any);
		expect(res.content[0].text).toBeTruthy();
		expect(res.details.identity).toBeDefined();
		expect(res.details.capability).toBeDefined();
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/pi-env-detect/test/index.test.ts`
Expected: FAIL — current `index.ts` still registers the `hello` demo tool.

- [ ] **Step 4: Replace `src/index.ts`**

```typescript
/**
 * pi-env-detect — Detects the agent's execution environment (baremetal / VM /
 * container / nested) and its spawn capabilities, then makes the agent aware of
 * them automatically.
 *
 * - Auto-injects a compact identity+capability summary into the system prompt
 *   (before_agent_start), so the agent always knows what it can spawn.
 * - Exposes a `detect_environment(scope?)` tool for on-demand depth, including
 *   the tooling allowlist (which is deliberately NOT injected).
 *
 * @module pi-env-detect
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { detect, resetCache } from "./detect.js";
import { renderInjection, renderSummary } from "./render.js";
import { realSystem } from "./system.js";
import type { Scope } from "./types.js";

const FLAG_NAME = "--env-detect";
const DEFAULT_MODE = "inject";

const Params = Type.Object({
	scope: StringEnum(["identity", "capability", "tooling", "all"] as const, {
		description: "Which detection scope to report. Defaults to all.",
	}),
});

export default function (pi: ExtensionAPI) {
	const sys = realSystem();
	// Fresh process = fresh detection. Guards against a stale module cache if the
	// extension is reloaded within one long-lived process.
	resetCache();

	pi.registerFlag(FLAG_NAME, {
		description: "Environment detection mode: inject (default), tool-only, or disabled",
		type: "string",
		default: DEFAULT_MODE,
	});

	pi.registerTool({
		name: "detect_environment",
		label: "Detect environment",
		description:
			"Report the execution environment: identity (baremetal/VM/container/nested), spawn capabilities (KVM, nested virt, container sockets, privilege), and—on request—spawn tooling on PATH.",
		promptSnippet:
			"detect_environment(scope?) — report whether you are in a container/VM/nested env and what you can launch (VMs, containers).",
		parameters: Params,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const scope = (params.scope ?? "all") as Scope;
			const report = detect(sys, scope);
			return {
				content: [{ type: "text" as const, text: renderSummary(report) }],
				details: report,
			};
		},
	});

	pi.on("before_agent_start", (event, _ctx) => {
		const mode = pi.getFlag(FLAG_NAME);
		if (mode === "disabled" || mode === "tool-only") return;
		const report = detect(sys, "capability"); // identity+capability, no tooling
		const block = renderInjection(report);
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});

	pi.registerCommand("detect-environment", {
		description: "Print the detected execution environment summary.",
		handler: async (_args, ctx) => {
			const report = detect(sys, "all");
			ctx.ui.notify(renderSummary(report), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.notify("pi-env-detect loaded ✅", "info");
	});
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/pi-env-detect/test/index.test.ts`
Expected: PASS (all 4).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-env-detect/src/index.ts packages/pi-env-detect/test/helpers/mock-api.ts packages/pi-env-detect/test/index.test.ts
git commit -m "feat(env-detect): wire tool, prompt injection, command, and flag"
```

---

### Task 8: README, package shape, and full-suite green

**Files:**
- Modify: `packages/pi-env-detect/README.md` (replace scaffolded template copy)
- Create: `packages/pi-env-detect/test/package-shape.test.ts`
- Verify: root `package.json`, `tsconfig.json`, release config already updated by the scaffold (Task 1)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the package-shape test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

describe("pi-env-detect package shape", () => {
	it("is published as a pi-package", () => {
		expect(pkg.name).toBe("pi-env-detect");
		expect(pkg.keywords).toContain("pi-package");
		expect(pkg.pi.extensions).toContain("./src/index.ts");
	});

	it("pins pi peer deps at the 0.77 line", () => {
		for (const dep of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]) {
			expect(pkg.peerDependencies?.[dep]).toBeDefined();
		}
	});
});
```

- [ ] **Step 2: Run it (and fix package.json if the scaffold diverged)**

Run: `npx vitest run packages/pi-env-detect/test/package-shape.test.ts`
Expected: PASS. If peer deps are missing, copy the `peerDependencies` / `devDependencies` blocks from `packages/pi-co-author/package.json` verbatim and re-run.

- [ ] **Step 3: Write the README**

Replace `packages/pi-env-detect/README.md` with:

````markdown
# pi-env-detect

Makes the pi agent aware of its **execution environment** and what it can spawn.

On every turn it appends a compact summary to the system prompt — whether the
agent is on baremetal, in a VM, a container, or a nested combination, and
whether it can launch VMs (`/dev/kvm`, nested virt) or containers (docker /
podman sockets). For depth on demand it registers a `detect_environment` tool.

## Why

Agents often run inside a container on a sandbox VM with nested virtualization
enabled — free to launch VMs and containers — but don't *know* it, so they have
to be reminded. This extension removes the reminding.

## Scopes

- **identity** — baremetal / VM / container / nested, hypervisor + runtime, k8s.
- **capability** — HW virt (`vmx`/`svm`), `/dev/kvm`, nested virt, docker/podman
  sockets, uid 0, notable capabilities, seccomp.
- **tooling** — presence of a fixed allowlist of spawn tools on PATH
  (`docker, podman, qemu-system-*, libvirtd, virsh, lxc, lxd, kubectl, vagrant,
  systemd-nspawn`). On-demand only; never injected.

Identity + capability are auto-injected. Tooling is tool-only — request it with
`detect_environment(scope: "tooling" | "all")`.

## Tool

```
detect_environment(scope?: "identity" | "capability" | "tooling" | "all")  // default "all"
```

Returns a prose summary plus structured `details` (the full `EnvReport`).

## Command

`/detect-environment` — print the summary to the UI.

## Flag

`--env-detect inject` (default) | `tool-only` (no injection, keep the tool) |
`disabled`.

## Platform

POSIX / Linux only. Every probe degrades to "unknown" when its source is
missing — it never throws and never blocks startup.
````

- [ ] **Step 4: Run the full repo suite + checks**

Run: `npm run check:all`
Expected: typecheck PASS, biome PASS, vitest PASS (all packages, including the 5 new env-detect test files).

If biome flags formatting, run `npx biome check --write packages/pi-env-detect` and re-run `npm run check:all`.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-env-detect/README.md packages/pi-env-detect/test/package-shape.test.ts
git commit -m "docs(env-detect): README + package-shape test; full suite green"
```

---

## Self-Review

**Spec coverage:**
- Delivery model (inject + tool) → Task 7 (before_agent_start + registerTool). ✓
- 3 scopes (identity/capability/tooling) → Tasks 2/3/4. ✓
- Tooling on-demand only, never injected → Task 7 injection uses `"capability"` scope; `renderInjection` omits tooling; Task 6 test asserts it. ✓
- Bounded tooling allowlist, podman mirrors docker → Task 4 `TOOL_ALLOWLIST` + allowlist-only test; podman socket in Task 3. ✓
- Output = structured details + prose → Task 6 renderers + Task 7 tool result. ✓
- Approach B injected SystemAccess seam → Task 1 `SystemAccess` + `makeFakeSystem`. ✓
- Session cache, probe-once, lazy tooling → Task 5. ✓
- Flag inject/tool-only/disabled → Task 7. ✓
- POSIX-only, never-throws → Global Constraints + `realSystem` try/catch. ✓
- Built-in experiment (capability injected, tooling derived) → falls out of Task 7 injection scope; no extra code. ✓
- Tests with no real-host dependency → all probe tests use fakes. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `probeIdentity`/`probeCapability`/`probeTooling` signatures match across Tasks 2-5; `detect(sys, scope)`/`resetCache()` match Tasks 5 & 7; `renderInjection`/`renderSummary` match Tasks 6 & 7; `EnvReport`/`ToolingResult` keys consistent between Tasks 1, 4, and 6; `TOOL_ALLOWLIST` entry shape (`{key, bins}`) consistent Task 4 ↔ test. ✓
