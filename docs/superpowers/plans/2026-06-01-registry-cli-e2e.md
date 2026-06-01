# Registry full CLI E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove `pi-monorepo-registry`'s install→reload→use loop end-to-end against the real `pi` binary, in CI and locally, with no LLM/API key required.

**Architecture:** A new `shared/registry-e2e.ts` harness spawns the real `pi` binary in `--print` mode against a shared temp `agentDir`, one spawn per loop step (registry add → package install → fresh-pi verify). A tiered test file (`cli-loop-e2e.test.ts`) runs that loop three ways: local `--dev` symlink, local bare-git clone, and a network-gated GitHub clone. A dedicated CI job runs the suite with a hard failure if the binary is absent.

**Tech Stack:** Node 22, vitest 3, `@earendil-works/pi-coding-agent` 0.77 (`node_modules/.bin/pi`), git, GitHub Actions.

---

## Background the engineer needs

The registry has no UI/LLM dependency. Its commands mutate filesystem state, then a *fresh* pi process picks the result up:

```
agentDir = <tmp>/.pi/agent      (set via env PI_CODING_AGENT_DIR)

pi #1  -e <registry>  "/monorepo-registry add <url> packages"
   └─► writes <tmp>/.pi/monorepo/state.json

pi #2  -e <registry>  "/monorepo-package install <pkg> --dev <dir>"   (or --git)
   ├─► symlink (or clone) at <tmp>/.pi/monorepo/extensions/<pkg>
   └─► bridge file <tmp>/.pi/agent/settings.json = { "extensions": [".pi/monorepo/extensions"] }

pi #3  (NO -e)  "/<command-the-pkg-registers>"
   └─► discovered via settings.json → handled → exit 0, no agent_start
```

**Model-free pass/fail signal (validated manually):**
- *Handled*: `exitCode === 0`, no `agent_start` event in the JSON stream, no `No API key found` text. Requires no model.
- *Fell through to LLM*: an `agent_start` event appears and/or stdout contains `No API key found`, exit 1.

**Exact CLI surface (from `packages/pi-monorepo-registry/src/index.ts`):**
- `/monorepo-registry add <url> [packages-root]` — local fs path OR git url. `packages-root` defaults to `packages`.
- `/monorepo-package install <name> --dev <path>` — symlink to a local checkout.
- `/monorepo-package install <name> --git [--source <url>]` — clone the source repo, symlink the package dir. Requires a matching registered source (or `--source`).
- `git`-style URLs are detected by `isGitUrl` in `src/git.ts`, which matches `http(s)://`, `git@`, `git://`, and `file://`. A bare filesystem path (no scheme) is treated as a **local source** (read directly, not cloned). So tier 2 must register the bare repo with a `file://` prefix to force the clone path.

**`pi` spawn flags used everywhere:** `--mode json --no-session --print --no-builtin-tools`. The binary is `node_modules/.bin/pi` (executable, shebang `node`).

**Existing reusable code (`shared/cli-e2e.ts`):** `discoverPiBinary(): string | null`, `parseEvents(stdout): CliEvent[]`, type `CliEvent`. We reuse `parseEvents` and `discoverPiBinary`. We do **not** reuse `spawnCli` because it hardcodes a single `--extension` and does not set custom env (we need 0..n extensions and `PI_CODING_AGENT_DIR`).

**Gating strategy (avoids double-runs + silent green):**
- The loop file lives under `packages/pi-monorepo-registry/test/`, so the existing `test-package` matrix job and root `vitest` would otherwise run it. Wrap all tiers in `describe.skipIf(!process.env.RUN_REGISTRY_CLI_E2E)`. Only the new dedicated job sets that env, so it owns the heavy run; everywhere else it is a *visible* skip.
- Tier 3 (network) is additionally `it.skipIf(!process.env.RUN_NETWORK_E2E)`.
- Inside the gated suite, `requirePiBinary()` throws in `beforeAll` if the binary is missing → the dedicated job fails loudly (kills the false-green).

---

## File structure

- **Create** `shared/registry-e2e.ts` — the harness (spawn + assertions + version helpers). One responsibility: drive and judge a single `pi` step.
- **Create** `shared/test/registry-e2e.test.ts` — unit tests for the harness's pure helpers + version coherence. Describe names deliberately omit the substring `CLI e2e` so the `test:cli-e2e` name-filter job ignores them.
- **Create** `packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts` — the three-tier loop test.
- **Modify** `.github/workflows/ci.yml` — add the `registry-e2e` job.

---

## Task 1: Harness — `shared/registry-e2e.ts`

**Files:**
- Create: `shared/registry-e2e.ts`
- Create (test): `shared/test/registry-e2e.test.ts`

- [ ] **Step 1: Write the harness module**

Create `shared/registry-e2e.ts`:

```ts
/**
 * Harness for pi-monorepo-registry full CLI e2e tests.
 *
 * Spawns the real `pi` binary in --print mode against a shared temp agentDir,
 * one spawn per loop step. Provides a model-free "command handled" assertion
 * (no agent_start event, no missing-API-key fallthrough) and binary/SDK
 * version-coherence helpers.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CliEvent, discoverPiBinary, parseEvents } from "./cli-e2e.js";

export type PiStepResult = {
	events: CliEvent[];
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
};

/** Discover the pi binary, throwing (not skipping) when absent. */
export function requirePiBinary(): string {
	const bin = discoverPiBinary();
	if (!bin) {
		throw new Error(
			"pi binary not found at node_modules/.bin/pi — registry CLI e2e requires it. " +
				"Run `npm ci` so @earendil-works/pi-coding-agent is installed.",
		);
	}
	return bin;
}

export type RunPiStepOptions = {
	agentDir: string;
	message: string;
	/** Zero or more extension entry paths → repeated `--extension`. */
	extensions?: string[];
	cwd?: string;
	timeout?: number;
};

/** Spawn one `pi --print` step pinned to agentDir. */
export function runPiStep(binary: string, opts: RunPiStepOptions): Promise<PiStepResult> {
	const { agentDir, message, extensions = [], cwd, timeout = 60_000 } = opts;
	return new Promise((resolve) => {
		const args = ["--mode", "json", "--no-session", "--print", "--no-builtin-tools"];
		for (const ext of extensions) args.push("--extension", ext);
		args.push(message);

		const proc = spawn(binary, args, {
			cwd: cwd ?? process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGKILL");
		}, timeout);

		proc.stdout.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});
		proc.stderr.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});

		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ events: parseEvents(stdout), stdout, stderr, exitCode: code, timedOut });
		};

		proc.on("close", finish);
		proc.on("error", (err) => {
			stderr += `\nSpawn error: ${err.message}`;
			finish(null);
		});
	});
}

const NO_API_KEY = /No API key found/i;

/** Assert a slash command was handled by an extension with no LLM fallthrough. */
export function assertHandledOffline(r: PiStepResult): void {
	if (r.timedOut) {
		throw new Error(`pi step timed out.\nstderr: ${r.stderr.trim() || "(empty)"}`);
	}
	if (r.events.some((e) => e.type === "agent_start")) {
		throw new Error(
			`Command fell through to LLM (agent_start present). Events: ${JSON.stringify(r.events.map((e) => e.type))}`,
		);
	}
	if (NO_API_KEY.test(r.stdout) || NO_API_KEY.test(r.stderr)) {
		throw new Error(`Command fell through to LLM (No API key found).\nstdout: ${r.stdout.trim()}`);
	}
	if (r.exitCode !== 0) {
		throw new Error(`pi step exited ${r.exitCode}.\nstderr: ${r.stderr.trim() || "(empty)"}`);
	}
}

/** Assert a command fell through to the LLM (negative control). */
export function assertFellThrough(r: PiStepResult): void {
	const fell =
		r.events.some((e) => e.type === "agent_start") || NO_API_KEY.test(r.stdout) || NO_API_KEY.test(r.stderr);
	if (!fell) {
		throw new Error(`Expected fallthrough to LLM but command looks handled.\nstdout: ${r.stdout.trim()}`);
	}
}

function nearestPackageRoot(startFile: string): string {
	let dir = dirname(startFile);
	while (!existsSync(join(dir, "package.json"))) {
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`No package.json above ${startFile}`);
		dir = parent;
	}
	return dir;
}

/** Package root that provides the SDK the in-process tests import. */
export function sdkPackageRoot(): string {
	// import.meta.resolve uses ESM resolution (the package only exposes an
	// "import" condition, so createRequire().resolve would throw).
	return nearestPackageRoot(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
}

/** Package root that provides the discovered `pi` binary. */
export function binaryPackageRoot(): string {
	return nearestPackageRoot(realpathSync(requirePiBinary()));
}

export function pkgVersionAt(root: string): string {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version as string;
}
```

- [ ] **Step 2: Write the failing harness unit test**

Create `shared/test/registry-e2e.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	assertFellThrough,
	assertHandledOffline,
	binaryPackageRoot,
	type PiStepResult,
	pkgVersionAt,
	sdkPackageRoot,
} from "../registry-e2e.js";

function result(partial: Partial<PiStepResult>): PiStepResult {
	return { events: [], stdout: "", stderr: "", exitCode: 0, timedOut: false, ...partial };
}

describe("registry-e2e harness: assertHandledOffline", () => {
	it("passes for a clean handled step", () => {
		expect(() => assertHandledOffline(result({ events: [{ type: "session" }] }))).not.toThrow();
	});

	it("throws when agent_start is present (LLM fallthrough)", () => {
		expect(() => assertHandledOffline(result({ events: [{ type: "agent_start" }] }))).toThrow(/fell through/i);
	});

	it("throws on missing-API-key fallthrough", () => {
		expect(() => assertHandledOffline(result({ stdout: "No API key found for model" }))).toThrow(/No API key/i);
	});

	it("throws on non-zero exit", () => {
		expect(() => assertHandledOffline(result({ exitCode: 1 }))).toThrow(/exited 1/);
	});

	it("throws on timeout", () => {
		expect(() => assertHandledOffline(result({ timedOut: true }))).toThrow(/timed out/i);
	});
});

describe("registry-e2e harness: assertFellThrough", () => {
	it("passes when agent_start present", () => {
		expect(() => assertFellThrough(result({ events: [{ type: "agent_start" }] }))).not.toThrow();
	});

	it("throws when the command was actually handled", () => {
		expect(() => assertFellThrough(result({ events: [{ type: "session" }] }))).toThrow(/Expected fallthrough/i);
	});
});

describe("registry-e2e harness: version coherence", () => {
	it("binary and SDK resolve to the same install", () => {
		expect(binaryPackageRoot()).toBe(sdkPackageRoot());
	});

	it("binary and SDK report the same semver", () => {
		expect(pkgVersionAt(binaryPackageRoot())).toBe(pkgVersionAt(sdkPackageRoot()));
	});
});
```

- [ ] **Step 3: Run the unit test — expect PASS**

Run: `npx vitest run shared/test/registry-e2e.test.ts`
Expected: all tests PASS (the pure assertions plus the two version-coherence tests; the binary is present via `npm ci`/workspace install).

- [ ] **Step 4: Commit**

```bash
git add shared/registry-e2e.ts shared/test/registry-e2e.test.ts
git commit -m "test(registry): add CLI e2e harness with model-free handled assertion"
```

---

## Task 2: Tier 1 — local workspace `--dev` symlink loop

**Files:**
- Create: `packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`

- [ ] **Step 1: Write the tier-1 loop test (gated, with negative control)**

Create `packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`:

```ts
/**
 * Full CLI e2e loop for pi-monorepo-registry, driven through the real pi binary.
 *
 * Each tier runs: registry add → package install → fresh pi runs the installed
 * command, asserting it is handled with no LLM fallthrough. Gated behind
 * RUN_REGISTRY_CLI_E2E so the heavy spawns run only in the dedicated CI job.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFellThrough, assertHandledOffline, requirePiBinary, runPiStep } from "../../../shared/registry-e2e.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const registrySrc = path.resolve(__dirname, "../src/index.ts");
const piTemplateDir = path.resolve(repoRoot, "packages", "pi-template");

const RUN = !!process.env.RUN_REGISTRY_CLI_E2E;

const tempDirs: string[] = [];
function mkTemp(label: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), `regloop-${label}-`));
	tempDirs.push(dir);
	return dir;
}
/** Create <tmp>/.pi/agent and return that agentDir. */
function makeAgentDir(label: string): string {
	const agentDir = path.join(mkTemp(label), ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	return agentDir;
}

afterAll(() => {
	for (const dir of tempDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

describe.skipIf(!RUN)("registry full CLI loop (real pi binary)", () => {
	let pi: string;

	beforeAll(() => {
		pi = requirePiBinary(); // hard-fail in the dedicated job if the binary is missing
	});

	it("tier 1: local --dev symlink → fresh pi runs the installed /greet", async () => {
		const agentDir = makeAgentDir("t1");

		const add = await runPiStep(pi, {
			agentDir,
			extensions: [registrySrc],
			message: `/monorepo-registry add ${repoRoot} packages`,
		});
		assertHandledOffline(add);

		const install = await runPiStep(pi, {
			agentDir,
			extensions: [registrySrc],
			message: `/monorepo-package install pi-template --dev ${piTemplateDir}`,
		});
		assertHandledOffline(install);

		// Fresh pi, NO -e: discovery happens purely via the settings.json bridge.
		const use = await runPiStep(pi, { agentDir, message: "/greet" });
		assertHandledOffline(use);
	});

	it("negative control: an unknown command falls through to the LLM", async () => {
		const agentDir = makeAgentDir("ctrl");
		const r = await runPiStep(pi, { agentDir, extensions: [registrySrc], message: "/zzznope" });
		assertFellThrough(r);
	});
});
```

- [ ] **Step 2: Run tier 1 + control — expect PASS**

Run: `RUN_REGISTRY_CLI_E2E=1 npx vitest run packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`
Expected: 2 tests PASS (tier 1 loop + negative control). Each spawns 1–3 `pi` processes; allow ~30s.

- [ ] **Step 3: Verify it is a visible skip without the env flag**

Run: `npx vitest run packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`
Expected: the describe block is SKIPPED (0 spawns), suite reports skipped — not failed, not silently passing.

- [ ] **Step 4: Commit**

```bash
git add packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts
git commit -m "test(registry): tier 1 CLI loop (local --dev symlink) via real pi binary"
```

---

## Task 3: Tier 2 — local bare-git clone loop

**Files:**
- Modify: `packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`

This tier exercises the real `--git` clone→symlink path using an offline bare repo containing a minimal fixture extension that registers `/fixgreet`.

- [ ] **Step 1: Add the bare-git fixture builder + tier-2 test**

In `cli-loop-e2e.test.ts`, add this helper above the `describe` block (after `makeAgentDir`):

```ts
function git(dir: string, cmd: string): void {
	execSync(cmd, { cwd: dir, stdio: "pipe" });
}

/**
 * Build a bare git repo containing packages/fixture-ext, whose extension
 * registers a /fixgreet command. Returns a file:// URL (forces the clone path,
 * since a bare fs path would be treated as a local source).
 */
function buildBareFixtureRepo(): string {
	const bare = path.join(mkTemp("bare"), "repo.git");
	mkdirSync(bare, { recursive: true });
	git(bare, "git init --bare -b main");

	const work = mkTemp("work");
	git(work, `git clone "${bare}" .`);
	git(work, 'git config user.email "t@t.com"');
	git(work, 'git config user.name "T"');

	const pkgDir = path.join(work, "packages", "fixture-ext");
	mkdirSync(path.join(pkgDir, "src"), { recursive: true });
	execSync(`cat > "${path.join(pkgDir, "package.json")}" <<'JSON'
{ "name": "fixture-ext", "version": "1.0.0", "pi": { "extensions": ["./src/index.ts"] } }
JSON`);
	execSync(`cat > "${path.join(pkgDir, "src", "index.ts")}" <<'TS'
export default async function (pi: any) {
	pi.registerCommand("fixgreet", {
		description: "fixture command",
		handler: async (_args: string, ctx: any) => {
			ctx.ui.notify("fixture ok", "info");
		},
	});
}
TS`);

	git(work, "git add -A");
	git(work, 'git commit -m "fixture-ext v1.0.0"');
	git(work, "git push -u origin main");
	return `file://${bare}`;
}
```

Then add this test inside the `describe.skipIf(!RUN)` block, after the negative control:

```ts
	it("tier 2: local bare-git clone (--git) → fresh pi runs /fixgreet", async () => {
		const agentDir = makeAgentDir("t2");
		const sourceUrl = buildBareFixtureRepo();

		const add = await runPiStep(pi, {
			agentDir,
			extensions: [registrySrc],
			message: `/monorepo-registry add ${sourceUrl} packages`,
		});
		assertHandledOffline(add);

		const install = await runPiStep(pi, {
			agentDir,
			extensions: [registrySrc],
			message: "/monorepo-package install fixture-ext --git",
		});
		assertHandledOffline(install);

		const use = await runPiStep(pi, { agentDir, message: "/fixgreet" });
		assertHandledOffline(use);
	});
```

- [ ] **Step 2: Run tier 2 — expect PASS**

Run: `RUN_REGISTRY_CLI_E2E=1 npx vitest run packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts -t "tier 2"`
Expected: PASS. If `add` fails because the registry could not enumerate packages from the clone, check `src/registry.ts addSource` clone behavior and confirm `isGitUrl` matches `file://` in `src/git.ts`; the fix belongs in the source, not the test.

- [ ] **Step 3: Commit**

```bash
git add packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts
git commit -m "test(registry): tier 2 CLI loop (local bare-git clone) via real pi binary"
```

---

## Task 4: Tier 3 — network-gated GitHub clone loop

**Files:**
- Modify: `packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`

- [ ] **Step 1: Add the network-gated tier-3 test**

Inside the `describe.skipIf(!RUN)` block, after tier 2, add:

```ts
	it.skipIf(!process.env.RUN_NETWORK_E2E)(
		"tier 3: GitHub clone (--git) → fresh pi runs the installed /greet",
		async () => {
			const agentDir = makeAgentDir("t3");
			const sourceUrl = "https://github.com/Zaephor/pi-extensions.git";

			const add = await runPiStep(pi, {
				agentDir,
				extensions: [registrySrc],
				message: `/monorepo-registry add ${sourceUrl} packages`,
				timeout: 120_000,
			});
			assertHandledOffline(add);

			const install = await runPiStep(pi, {
				agentDir,
				extensions: [registrySrc],
				message: "/monorepo-package install pi-template --git",
				timeout: 120_000,
			});
			assertHandledOffline(install);

			const use = await runPiStep(pi, { agentDir, message: "/greet" });
			assertHandledOffline(use);
		},
	);
```

- [ ] **Step 2: Run tier 3 locally — expect PASS (requires network)**

Run: `RUN_REGISTRY_CLI_E2E=1 RUN_NETWORK_E2E=1 npx vitest run packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts -t "tier 3"`
Expected: PASS (clones the public repo over HTTPS; ~tens of seconds).

- [ ] **Step 3: Confirm tier 3 is a visible skip without the network flag**

Run: `RUN_REGISTRY_CLI_E2E=1 npx vitest run packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts`
Expected: tiers 1 and 2 PASS; tier 3 reported as SKIPPED (not failed).

- [ ] **Step 4: Commit**

```bash
git add packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts
git commit -m "test(registry): tier 3 CLI loop (network-gated GitHub clone) via real pi binary"
```

---

## Task 5: Dedicated CI job `registry-e2e`

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job**

Append to `.github/workflows/ci.yml` (after the `test-cli-e2e` job, matching its 3-space indentation):

```yaml
  registry-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm

      - run: npm ci

      - name: Registry full CLI loop (tiers 1+2; tier 3 network-gated off)
        env:
          RUN_REGISTRY_CLI_E2E: "1"
        run: npx vitest run --reporter=verbose packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts shared/test/registry-e2e.test.ts
```

Notes for the engineer:
- `RUN_NETWORK_E2E` is intentionally **unset** here, so tier 3 is a visible skip on push/PR. A later nightly/manual workflow can set it — out of scope for this plan.
- `requirePiBinary()` runs in the suite's `beforeAll`; if `npm ci` ever fails to provide `node_modules/.bin/pi`, this job fails loudly instead of skipping.

- [ ] **Step 2: Validate the workflow file locally**

Run: `npx --yes yaml-lint .github/workflows/ci.yml 2>/dev/null || node -e "require('node:fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('readable')"`
Expected: no YAML parse error (prints `readable` if the linter is unavailable).

- [ ] **Step 3: Run the exact CI command locally**

Run: `RUN_REGISTRY_CLI_E2E=1 npx vitest run --reporter=verbose packages/pi-monorepo-registry/test/cli-loop-e2e.test.ts shared/test/registry-e2e.test.ts`
Expected: harness unit tests PASS; tiers 1+2 PASS; tier 3 SKIPPED.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add registry-e2e job running the full CLI loop"
```

---

## Task 6: Full local gate + push verification

**Files:** none (verification only)

- [ ] **Step 1: Run the standard suites to confirm no regressions / no accidental heavy runs**

Run: `npm run typecheck && npm run check && npx vitest run packages/pi-monorepo-registry`
Expected: typecheck + lint PASS; the package suite PASSES with the loop describe SKIPPED (no `RUN_REGISTRY_CLI_E2E`), proving the heavy loop does not run in the normal `test-package` lane.

- [ ] **Step 2: Confirm release config still in sync (tests can leave registry state)**

Run: `npm run sync-release-config -- --check`
Expected: in sync. If a test left entries in `release-please-config.json`, run `git checkout release-please-config.json` and re-check.

- [ ] **Step 3: Push and watch the new CI job**

```bash
git push
```
Expected: the `registry-e2e` job is green; tiers 1+2 ran, tier 3 shows as skipped. The pre-existing jobs remain green.

---

## Self-review notes

- **Spec coverage:** harness `requirePiBinary`/`runPiStep`/`assertHandledOffline`/`assertFellThrough`/version helpers → Task 1. Tier 1 local symlink → Task 2. Tier 2 bare-git → Task 3. Tier 3 network-gated GitHub → Task 4. Dedicated job + hard-fail + tier-3 gate → Task 5. Version-coherence test → Task 1 (steps 2–3). Silent-skip fix → `requirePiBinary` + the dedicated job owning the run (Tasks 1, 5). All spec components mapped.
- **Naming consistency:** `assertHandledOffline`, `assertFellThrough`, `runPiStep`, `requirePiBinary`, `sdkPackageRoot`, `binaryPackageRoot`, `pkgVersionAt`, `RUN_REGISTRY_CLI_E2E`, `RUN_NETWORK_E2E`, `/fixgreet`, `fixture-ext` used identically across tasks.
- **Gating:** loop file gated by `RUN_REGISTRY_CLI_E2E` (skip-visible elsewhere); tier 3 additionally by `RUN_NETWORK_E2E`; harness unit-test describe names omit `CLI e2e` so the name-filtered `test:cli-e2e` job ignores them.
```
