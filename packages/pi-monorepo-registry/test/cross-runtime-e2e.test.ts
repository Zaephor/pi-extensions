/**
 * Cross-runtime e2e test — verifies that extension activation (symlinks)
 * is properly scoped to the invoking runtime's agent directory.
 *
 * Three scenarios:
 * 1. Activate via pi   → symlink in pi agent dir only,   not in gsd
 * 2. Activate via gsd  → symlink in gsd agent dir only,  not in pi
 * 3. Activate in both  → symlinks in both, both load without errors
 *
 * GSD tests are skipped unless @gsd/pi-coding-agent is resolvable.
 *
 * These tests exercise the activation layer directly, then verify loading
 * via each runtime's SDK.
 */

import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths to extension source dirs
const piCoAuthorDir = path.resolve(__dirname, "../../pi-co-author");
const piCoAuthorSrc = path.join(piCoAuthorDir, "src/index.ts");

// Try gsd
let gsdApi: any = null;
try {
	gsdApi = await import("@gsd/pi-coding-agent");
} catch {}
const gsdAvailable = gsdApi !== null;

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) {
		try { rmSync(dir, { recursive: true, force: true }); } catch {}
	}
});

function makeTemp(prefix: string): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), `xrt-${prefix}-`));
	tempDirs.push(dir);
	return dir;
}

/** Check if a symlink exists pointing to the expected target. */
function isSymlinked(extensionsDir: string, name: string): boolean {
	const linkPath = path.join(extensionsDir, name);
	if (!existsSync(linkPath)) return false;
	try {
		return lstatSync(linkPath).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Create extensions dir structure under an agent dir. */
function makeExtensionsDir(agentDir: string): string {
	const extDir = path.join(agentDir, "extensions");
	mkdirSync(extDir, { recursive: true });
	return extDir;
}

// ===========================================================================
// Scenario 1: Activate via pi only
// ===========================================================================
describe("Scenario 1: Activate via pi only", () => {
	const pkgName = "pi-co-author";
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp("pi-s1");
		gsdAgentDir = makeTemp("gsd-s1");

		const piExtDir = makeExtensionsDir(piAgentDir);
		// Don't create gsd extensions dir at all

		// Override agent dir resolution for pi context
		// PI_PACKAGE_DIR takes precedence, so we unset it and use PI_CODING_AGENT_DIR
		const savedPiPackageDir = process.env.PI_PACKAGE_DIR;
		delete process.env.PI_PACKAGE_DIR;
		process.env.PI_CODING_AGENT_DIR = piAgentDir;

		const { createActivationSymlink } = await import("../src/activation.js");
		await createActivationSymlink(piCoAuthorDir, pkgName, "global");

		// Restore env
		delete process.env.PI_CODING_AGENT_DIR;
		if (savedPiPackageDir) process.env.PI_PACKAGE_DIR = savedPiPackageDir;
	});

	it("symlink exists in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("symlink does NOT exist in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "extensions"), pkgName)).toBe(false);
	});

	it("pi SDK loads the extension without errors", async () => {
		const { createAgentSession, DefaultResourceLoader, SessionManager } =
			await import("@mariozechner/pi-coding-agent");

		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: piAgentDir,
			noExtensions: false,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		const result = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		expect(result.extensionsResult.errors).toHaveLength(0);
		const hasFlag = result.extensionsResult.extensions.some(
			(ext: any) => ext.flags.has("co-author-mode"),
		);
		expect(hasFlag).toBe(true);
	});
});

// ===========================================================================
// Scenario 2: Activate via gsd only
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 2: Activate via gsd only", () => {
	const pkgName = "pi-co-author";
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp("pi-s2");
		gsdAgentDir = makeTemp("gsd-s2");

		// Only create gsd extensions dir
		makeExtensionsDir(gsdAgentDir);

		// Override agent dir resolution for gsd context
		const savedPiPackageDir = process.env.PI_PACKAGE_DIR;
		delete process.env.PI_PACKAGE_DIR;
		process.env.PI_CODING_AGENT_DIR = gsdAgentDir;

		const { createActivationSymlink } = await import("../src/activation.js");
		await createActivationSymlink(piCoAuthorDir, pkgName, "global");

		delete process.env.PI_CODING_AGENT_DIR;
		if (savedPiPackageDir) process.env.PI_PACKAGE_DIR = savedPiPackageDir;
	});

	it("symlink exists in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("symlink does NOT exist in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "extensions"), pkgName)).toBe(false);
	});

	it("gsd SDK loads the extension without errors", async () => {
		const { createAgentSession, DefaultResourceLoader, SessionManager } = gsdApi!;

		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: gsdAgentDir,
			noExtensions: false,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		const result = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		expect(result.extensionsResult.errors).toHaveLength(0);
		const hasFlag = result.extensionsResult.extensions.some(
			(ext: any) => ext.flags.has("co-author-mode"),
		);
		expect(hasFlag).toBe(true);
	});
});

// ===========================================================================
// Scenario 3: Activate in both pi and gsd
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 3: Activate in both pi and gsd", () => {
	const pkgName = "pi-co-author";
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp("pi-s3");
		gsdAgentDir = makeTemp("gsd-s3");

		makeExtensionsDir(piAgentDir);
		makeExtensionsDir(gsdAgentDir);

		const savedPiPackageDir = process.env.PI_PACKAGE_DIR;

		// Activate in pi
		delete process.env.PI_PACKAGE_DIR;
		process.env.PI_CODING_AGENT_DIR = piAgentDir;
		const { createActivationSymlink } = await import("../src/activation.js");
		await createActivationSymlink(piCoAuthorDir, pkgName, "global");
		delete process.env.PI_CODING_AGENT_DIR;

		// Activate in gsd
		process.env.PI_CODING_AGENT_DIR = gsdAgentDir;
		const { createActivationSymlink: activate2 } = await import("../src/activation.js");
		await activate2(piCoAuthorDir, pkgName, "global");
		delete process.env.PI_CODING_AGENT_DIR;

		// Restore
		if (savedPiPackageDir) process.env.PI_PACKAGE_DIR = savedPiPackageDir;
	});

	it("symlink exists in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("symlink exists in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("pi SDK loads without errors", async () => {
		const { createAgentSession, DefaultResourceLoader, SessionManager } =
			await import("@mariozechner/pi-coding-agent");

		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: piAgentDir,
			noExtensions: false,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		const result = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		expect(result.extensionsResult.errors).toHaveLength(0);
	});

	it("gsd SDK loads without critical errors (flag conflict is expected but non-fatal)", async () => {
		const { createAgentSession, DefaultResourceLoader, SessionManager } = gsdApi!;

		// Simulate gsd's buildResourceLoader cross-scanning ~/.pi/agent/extensions/
		const piCrossScanPath = path.join(piAgentDir, "extensions", pkgName, "src", "index.ts");

		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: gsdAgentDir,
			additionalExtensionPaths: existsSync(piCrossScanPath) ? [piCrossScanPath] : [],
			noExtensions: false,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();

		const result = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		// Flag conflicts are reported as errors but are non-fatal — the extension still loads
		const criticalErrors = result.extensionsResult.errors.filter(
			(e: any) => !e.error.includes("conflicts with"),
		);
		expect(criticalErrors).toHaveLength(0);

		// Extension should still be loaded
		const loaded = result.extensionsResult.extensions.length;
		expect(loaded).toBeGreaterThanOrEqual(1);
	});
});
