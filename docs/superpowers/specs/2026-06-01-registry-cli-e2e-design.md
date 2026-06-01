# pi-monorepo-registry — full CLI E2E integration

**Date:** 2026-06-01
**Status:** Approved (design)
**Scope:** A single implementation plan.

## Problem

`pi-monorepo-registry` is the foundational package in this monorepo and has zero
dependency on a functioning LLM — its entire job is to manage *other* extensions:
register sources, install packages (symlink or git clone), and bridge them into pi
so a fresh pi process discovers and runs them.

Today that workflow is **not** proven end-to-end against the real pi binary.

### Current coverage

| Layer | File(s) | What it proves | Gap |
|-------|---------|----------------|-----|
| SDK in-process | `test/sdk-e2e.test.ts`, `test/runtime-e2e.test.ts` | Registry loads under pi's real SDK/jiti runtime; commands register; `session_start` subscribes; symlink reload cycle works | Drives registry commands through a **mock** `ExtensionAPI` (`installViaRegistry` → `createRegistryMock`), not pi's real command dispatch |
| CLI binary | `shared/cli-e2e.test.ts` (`createCommandHandledTest`) | Spawns the real `pi` binary; one command (`pi-template` `/greet`) is handled without LLM fallthrough | Never exercises the registry's own commands; **silently skips** when the binary is absent |

### Gaps closed by this work

1. No real-binary test of the registry's own commands (`/monorepo-registry add`, `/monorepo-package install`).
2. No full loop: pi process #1 installs → mutates `state.json` + agent `settings.json` + drops a symlink → pi process #2 (fresh) sees the installed package's command live.
3. **Silent skip = false green.** `createCommandHandledTest` calls `this.skip()` when no binary is found; if `npm ci` ever drops the bin in CI, the whole CLI lane passes as a no-op.
4. No version-coherence check between the spawned binary and the SDK the in-process tests import.

## Validated mechanism (de-risked before design)

All probes run against `node_modules/.bin/pi` (`@earendil-works/pi-coding-agent` 0.77.0):

- `pi --mode json --no-session --print -e <registry> "/monorepo-registry add <repo> packages"` → exit 0, writes `.pi/monorepo/state.json`.
- `... "/monorepo-package install pi-template --dev <pkgDir>"` → exit 0, creates symlink `.pi/monorepo/extensions/pi-template → packages/pi-template`, and writes the bridge `.pi/agent/settings.json` = `{ "extensions": [".pi/monorepo/extensions"] }`.
- Fresh pi, **no `-e`**, pure `settings.json` discovery, `"/greet"` → exit 0, only a `session` event (handled by extension, no LLM fallthrough).
- Control: bogus `"/zzznope"` → falls through to the LLM → `No API key found` → exit 1.

**Model-free pass/fail signal:** a handled command exits 0 with no `agent_start` event and no `No API key` text; an unhandled command falls through and dies on the missing key. No model or API key is ever required.

## Approach

Real binary, one `--print` spawn per loop step, against a shared temp `agentDir`.
Reuses the existing `spawnCli` harness.

Rejected alternatives:
- *SDK drives install, binary verifies* — the install half would bypass the binary's own arg-parsing/dispatch, which is exactly gap #1.
- *One interactive pi via PTY + `/reload`* — node-pty dependency, fragile output scraping, timing flakiness; no coverage beyond what fresh-process-#3 already proves.

## Components

### 1. Harness — `shared/registry-e2e.ts`

Pure helpers, no test bodies:

- `requirePiBinary(): string` — wraps `discoverPiBinary()`; **throws** if absent. Kills the silent-skip false-green (gap #3).
- `runPiStep(agentDir, message, opts?): Promise<CliSpawnResult>` — `spawnCli` pinned to `agentDir` via `PI_CODING_AGENT_DIR`, `--no-builtin-tools` for lean startup. `opts.extensions?: string[]` maps to repeated `-e`.
- `assertHandledOffline(result): void` — asserts exit 0, no `agent_start` event, and no `No API key` text in stdout/stderr. The model-free "handled" signal.
- `assertFellThrough(result): void` — the negative control (bogus command → fallthrough).
- `binaryVersion(): string` and `sdkVersion(): string` — read the bin's resolved `package.json` version and the imported SDK's version, for the coherence test.

### 2. Loop test — `packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`

Three tiers. Each tier: `add source → install → fresh pi runs the installed command → assertHandledOffline`. One shared bogus-command negative control (`assertFellThrough`) guards against the assertion passing vacuously.

- **Tier 1 — local workspace, `--dev` symlink.** Source = this repo's `packages/`; install `pi-template`; fresh pi `/greet`. Offline, always runs. *(Validated end-to-end above.)*
- **Tier 2 — local bare-git fixture.** Build a throwaway bare repo (reuse `stale-clone.test.ts` setup; set `git config user.email`/`user.name` on every clone that commits — CI runners have no global identity); register it as a git source; install (real clone → symlink); fresh pi runs the fixture package's command. Offline, always runs.
- **Tier 3 — real GitHub remote.** Env-gated `RUN_NETWORK_E2E`. Source = `https://github.com/Zaephor/pi-extensions.git` (this repo's own **public** remote — no third-party dependency); install `pi-template`; fresh pi `/greet`. Use `it.skipIf(!process.env.RUN_NETWORK_E2E)` so it is a **visible** skip, never a hidden one.

### 3. Version-coherence test

A small `it` (in the loop file) asserting `binaryVersion() === sdkVersion()`. Cheap drift guard (gap #4).

### 4. CI job — `registry-e2e` in `.github/workflows/ci.yml`

Node 22, `npm ci`, runs the loop test file. `requirePiBinary()` makes a missing binary a hard failure. Tiers 1+2 run on every push/PR; tier 3 stays skipped (no `RUN_NETWORK_E2E` set on PR/push) — a nightly/manual workflow that sets the env var can be added later, out of scope here.

## Data flow (the loop)

```
temp agentDir = <tmp>/.pi/agent     (PI_CODING_AGENT_DIR)
  │
pi #1  -e registry  "/monorepo-registry add <source> packages"
  └─► writes <tmp>/.pi/monorepo/state.json   (source + discovered packages)
  │
pi #2  -e registry  "/monorepo-package install <pkg> [--dev <dir>]"
  ├─► <tmp>/.pi/monorepo/extensions/<pkg>  (symlink, or clone for git source)
  └─► <tmp>/.pi/agent/settings.json = { extensions: [".pi/monorepo/extensions"] }
  │
pi #3  (no -e)      "/<installed-command>"
  └─► discovers via settings.json → command handled → exit 0, no agent_start
```

## Error handling

- Missing binary → `requirePiBinary()` throws → job fails loudly (intended).
- Each `runPiStep` inherits `spawnCli`'s timeout + kill; a hung step fails the test rather than hanging CI.
- Tier 2/3 git operations set an explicit git identity so commit steps don't fail on bare CI runners.
- Tier 3 network failure surfaces as a normal test failure only when `RUN_NETWORK_E2E` is set; otherwise the tier is a visible skip.

## Testing

The deliverable *is* tests. Validation: run the new file locally (`npx vitest run packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`) with tiers 1+2, then once with `RUN_NETWORK_E2E=1` to exercise tier 3, and confirm the new CI job is green on a PR.

## Out of scope

- Nightly/manual workflow that sets `RUN_NETWORK_E2E` (follow-up).
- Removing or rewriting the existing mock-driven `installViaRegistry` helper — it still serves the in-process SDK tests.
- `pi update` / uninstall flows (this loop covers add + install + use).

## Open items

None. Tier-3 source (`Zaephor/pi-extensions`) confirmed public.
