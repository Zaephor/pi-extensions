/**
 * Full CLI e2e loop for pi-monorepo-registry, driven through the real pi binary.
 *
 * Each tier runs: registry add → package install → fresh pi runs the installed
 * command, asserting it is handled with no LLM fallthrough. Gated behind
 * RUN_REGISTRY_CLI_E2E so the heavy spawns run only in the dedicated CI job.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFellThrough, assertHandledOffline, requirePiBinary, runPiStep } from "../../../shared/registry-e2e.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const registrySrc = path.resolve(__dirname, "../src/index.ts");
// Local workspace checkout — used for the --dev (symlink) install tier.
const piTemplateDir = path.resolve(repoRoot, "packages", "pi-template");

const RUN = !!process.env.RUN_REGISTRY_CLI_E2E;

const tempDirs: string[] = [];
function mkTemp(label: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), `regloop-${label}-`));
	tempDirs.push(dir);
	return dir;
}
/** Create <tmp>/.pi/agent and return that agentDir. Registers the temp root in tempDirs for afterAll cleanup. */
function makeAgentDir(label: string): string {
	const agentDir = path.join(mkTemp(label), ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });
	return agentDir;
}

describe.skipIf(!RUN)("registry full CLI loop (real pi binary)", () => {
	let pi: string;

	beforeAll(() => {
		pi = requirePiBinary(); // hard-fail in the dedicated job if the binary is missing
	});

	afterAll(() => {
		for (const dir of tempDirs.splice(0)) {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {}
		}
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
