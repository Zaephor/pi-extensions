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
