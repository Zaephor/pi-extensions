/**
 * Full CLI e2e loop for pi-monorepo-registry, driven through the real pi binary.
 *
 * Each tier runs: registry add → package install → fresh pi runs the installed
 * command, asserting it is handled with no LLM fallthrough. Gated behind
 * RUN_REGISTRY_CLI_E2E so the heavy spawns run only in the dedicated CI job.
 */
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function git(dir: string, cmd: string): void {
	execSync(cmd, { cwd: dir, stdio: "pipe" });
}

/**
 * Build a bare git repo containing packages/fixture-ext, whose extension
 * registers a /fixgreet command. Returns a file:// URL — the file:// scheme
 * forces the registry's git CLONE path (a bare fs path would be treated as a
 * local source and skip cloning).
 */
function buildBareFixtureRepo(): string {
	const bare = path.join(mkTemp("bare"), "repo.git");
	mkdirSync(bare, { recursive: true });
	git(bare, "git init --bare");
	git(bare, "git symbolic-ref HEAD refs/heads/main");

	const work = mkTemp("work");
	git(work, `git clone "${bare}" .`);
	git(work, 'git config user.email "t@t.com"');
	git(work, 'git config user.name "T"');

	const pkgSrc = path.join(work, "packages", "fixture-ext", "src");
	mkdirSync(pkgSrc, { recursive: true });
	writeFileSync(
		path.join(work, "packages", "fixture-ext", "package.json"),
		JSON.stringify({ name: "fixture-ext", version: "1.0.0", type: "module", pi: { extensions: ["./src/index.ts"] } }),
	);
	writeFileSync(
		path.join(pkgSrc, "index.ts"),
		[
			"export default async function (pi: any) {",
			'	pi.registerCommand("fixgreet", {',
			'		description: "fixture command",',
			"		handler: async (_args: string, ctx: any) => {",
			'			ctx.ui.notify("fixture ok", "info");',
			"		},",
			"	});",
			"}",
			"",
		].join("\n"),
	);

	git(work, "git add -A");
	git(work, 'git commit -m "fixture-ext v1.0.0"');
	git(work, "git push -u origin main");
	return `file://${bare}`;
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
	}, 90_000);

	it("negative control: an unknown command falls through to the LLM", async () => {
		const agentDir = makeAgentDir("ctrl");
		const r = await runPiStep(pi, { agentDir, extensions: [registrySrc], message: "/zzznope" });
		assertFellThrough(r);
	}, 60_000);

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
	}, 120_000);

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
		360_000,
	);
});
