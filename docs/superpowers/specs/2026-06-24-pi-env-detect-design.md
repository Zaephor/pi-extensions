# pi-env-detect — environment & capability detection extension

**Date:** 2026-06-24
**Status:** Approved (design)
**Scope:** A single implementation plan. New package `packages/pi-env-detect`.

## Problem

Agents frequently run inside a container, on a sandbox VM with nested
virtualization, or some layered combination — and they don't *know* it. The
operator has to manually remind the agent that it can launch VMs, spin up
sidecar containers, or use a Docker-in-Docker socket. The agent has the
capability but no awareness of it, so it under-uses the environment or asks
permission it doesn't need.

This extension gives the agent that awareness automatically, and a tool to
probe deeper on demand.

### Goal

The agent should, without prompting, know:

1. **Identity** — what am I running in? (baremetal / VM / container / nested)
2. **Capability** — what can I spawn? (KVM, nested virt, container sockets, privilege)
3. **Tooling** — which spawn-relevant binaries are actually on `$PATH`? (on demand)

## Delivery model (decided)

**Both** auto-injection and an on-demand tool:

- **Auto-inject (passive awareness):** a compact **identity + capability**
  summary is appended to the system prompt every turn via `before_agent_start`.
  This directly fixes the "have to remind the agent" pain — awareness is always
  present, no tool call required.
- **Tool (active depth):** `detect_environment(scope?)` lets the agent pull a
  precise, structured answer — including **tooling**, which is *not* injected by
  default to keep the prompt lean and avoid context pollution.

Rationale for splitting tooling out: it is the most verbose and least stable
scope, and pure PATH scanning is a slippery slope. Keeping it behind the tool
bounds the injected token cost and sets up the experiment below.

### Built-in experiment

Capability is injected but tooling is not. This lets us observe whether the
agent correctly *derives* tooling needs from capability signals (e.g. "the
docker socket exists → I should check for a `docker`/`podman` client"). If the
agent reliably derives it, tooling stays on-demand forever. If it flails, we
bump tooling into the injected summary later — a one-line change to which scopes
the renderer reads. Cheap to tune.

## Scopes & signals

All probes are POSIX/Linux-first, matching the repo's existing platform stance
(registry is POSIX-only). Each signal degrades gracefully to "unknown" when its
source is absent or unreadable — never throws.

### 1. Identity — *what am I in*

- `systemd-detect-virt` if present (most authoritative single source; reports
  both VM type and container type, or `none` for baremetal)
- DMI: `/sys/class/dmi/id/sys_vendor`, `product_name` (QEMU, VMware,
  VirtualBox, Amazon EC2, Google, Microsoft, etc.)
- `/proc/cpuinfo` `hypervisor` flag (running under a hypervisor)
- Container markers: `/.dockerenv`, `/run/.containerenv` (podman),
  `/proc/1/cgroup` / `/proc/self/cgroup` (docker / lxc / kubepods),
  `container` env var
- Kubernetes: `KUBERNETES_SERVICE_HOST`, `/var/run/secrets/kubernetes.io`
- **Nested** is derived: container markers present *and* a hypervisor/VM
  identity underneath ⇒ report the layering (e.g. "Docker container on a KVM VM").

### 2. Capability — *what can I spawn*

- HW virt extensions: `vmx` (Intel) / `svm` (AMD) in `/proc/cpuinfo` flags
- KVM usable: `/dev/kvm` exists **and** is accessible (stat + access check)
- Nested virt enabled: `/sys/module/kvm_intel/parameters/nested` or
  `kvm_amd/parameters/nested` reads `Y`/`1`
- Container runtime sockets (existence only — capability, not tooling):
  - Docker: `/var/run/docker.sock`, `DOCKER_HOST`
  - Podman: `/run/podman/podman.sock`, rootless
    `$XDG_RUNTIME_DIR/podman/podman.sock`, `CONTAINER_HOST`
- Privilege: uid 0; effective capabilities from `/proc/self/status` `CapEff`
  (notably `CAP_SYS_ADMIN`); seccomp mode; user-namespace hint

### 3. Tooling — *which clients are present* (on demand only)

Fixed allowlist — **never** a general PATH scan:

`docker, podman, qemu-system-* (any arch), libvirtd, virsh, lxc, lxd,
kubectl, vagrant, systemd-nspawn`

Reported as present/absent (+ resolved path). Docker and podman are reported
independently and mirrored throughout. Capability (socket exists) and tooling
(client binary exists) are deliberately distinct: you can have the socket
without a client, or the client without a running daemon — both true ⇒ actually
usable.

## Output shape (decided: structured + rendered)

- **Structured object** lives in the tool result's `details` field — precise,
  machine-clean, and the basis for the session cache:

  ```ts
  {
    identity:   { type, hypervisor, container, layers, k8s, sources },
    capability: { hwVirt, kvm, nestedVirt, dockerSocket, podmanSocket,
                  uid0, caps, seccomp },
    tooling?:   { docker, podman, qemu, libvirtd, virsh, lxc, lxd,
                  kubectl, vagrant, nspawn }   // present only when scope includes it
  }
  ```

- **Rendered prose summary** is the human/agent-readable text. Example:

  > Running in a Docker container on a KVM VM (nested). `/dev/kvm` is accessible
  > and nested virt is enabled — you can launch VMs. A podman socket is present
  > (rootless). No docker socket detected.

  The summary is what the `before_agent_start` injection appends (agents read
  prose well, cheap tokens) and also the tool's text content. Structured
  `details` backs precise answers and caching.

## Approach (decided: B — scoped modules + injected SystemAccess)

The whole design hinges on **not letting probes touch the real system
directly**, because they read `/proc`, `/sys`, `/dev`, env vars, and shell out —
untestable in CI otherwise, and impossible to exercise "what if `/dev/kvm`
existed" on a host where it doesn't.

Every probe is a pure function over a `SystemAccess` interface:

```ts
interface SystemAccess {
  readFile(path: string): string | undefined;   // undefined if missing/unreadable
  exists(path: string): boolean;
  access(path: string, mode: number): boolean;   // readable / writable check
  env(name: string): string | undefined;
  exec(cmd: string, args: string[]): { code: number; stdout: string } | undefined;
  which(bin: string): string | undefined;
}
```

A single real implementation wraps `node:fs` / `node:child_process` / pi's
exec. Tests inject fakes describing synthetic environments (cpuinfo with/without
`vmx`, kvm present/absent, docker socket present, etc.).

Rejected alternatives:

- **A — flat single module hitting the real system.** Smallest, but probes
  can't be unit-tested without the real env or invasive global mocking. Fails
  the repo's testing bar (registry has 15 test files).
- **C — B plus a persistent cache via tool-result `details`** (stateful-template
  pattern). YAGNI: the environment is host-stable for a session's lifetime, so a
  module-level cache is sufficient. Session-branch/replay persistence buys
  nothing for facts that don't change.

## Components

```
packages/pi-env-detect/
  src/
    index.ts        # wiring: registerTool, before_agent_start inject, /detect-environment command, flag
    system.ts       # SystemAccess interface + real impl over node:fs/child_process
    identity.ts     # probeIdentity(sys): IdentityResult
    capability.ts   # probeCapability(sys): CapabilityResult
    tooling.ts      # probeTooling(sys): ToolingResult  (allowlist)
    detect.ts       # detect(sys, scope) -> aggregates + module-level session cache
    render.ts       # renderSummary(result): string  (prose for inject + tool text)
    types.ts        # IdentityResult, CapabilityResult, ToolingResult, EnvReport, Scope
  test/             # one *.test.ts per probe module + detect (cache) + render + index wiring
  package.json      # mirrors pi-co-author: pi-package keyword, peerDeps on @earendil-works/pi-* ^0.77.0
  README.md
```

### Wiring (`index.ts`)

- `registerTool`:
  - `name: "detect_environment"`, `parameters`: `{ scope?: "identity" | "capability" | "tooling" | "all" }` (default `"all"`).
  - `promptSnippet`: one line so the agent knows the tool exists.
  - `execute`: `detect(sys, scope)` → result with prose `content` + structured `details`.
- `on("before_agent_start")`: append `renderSummary` of the cached
  **identity + capability** report to `systemPrompt`; return `{ systemPrompt }`.
  Skip when disabled.
- `registerCommand("detect-environment")`: print the summary to the UI
  (operator-facing; mirrors template `/greet` pattern).
- `registerFlag("--env-detect")`: `inject` (default) | `tool-only` | `disabled`.
  `tool-only` keeps the tool but suppresses injection; `disabled` turns both off.

### Caching (`detect.ts`)

Module-level `let cache: EnvReport | undefined`. First probe (whichever of
inject or tool fires first) populates it; everything reuses it for the process
lifetime. Tooling is probed lazily and merged in the first time a `tooling`/`all`
scope is requested. One probe pass per scope per session, max.

## Testing

- **Per-probe unit tests** (`identity`, `capability`, `tooling`): feed synthetic
  `SystemAccess` fakes, assert the structured result. Covers nested layering,
  vmx-present/absent, kvm accessible/not, docker-vs-podman sockets, rootless,
  CapEff parsing, allowlist boundaries (tooling never reports a non-allowlisted
  binary).
- **`detect` test:** cache populated once; second call doesn't re-probe (spy on
  the fake's call counts); tooling lazily merged.
- **`render` test:** golden prose for representative reports (baremetal, plain
  container, nested-with-kvm).
- **`index` wiring test (in-process SDK):** tool registers; `before_agent_start`
  returns an augmented `systemPrompt` containing the summary; `--env-detect
  disabled` suppresses it. Follows the registry's SDK-e2e style.
- No real-host dependency anywhere — the `SystemAccess` seam makes nested-virt
  and kvm scenarios fully synthetic. A real-binary e2e is **out of scope** for
  v1 (the detection facts can't be asserted on an arbitrary CI host anyway).

## Out of scope (v1)

- Windows / non-POSIX detection.
- General tooling/PATH inventory beyond the spawn allowlist.
- Persisting detection across sessions.
- Live re-detection mid-session (env is host-stable).
- Acting on the environment (launching VMs/containers) — this extension only
  *reports*; the agent decides what to do.
