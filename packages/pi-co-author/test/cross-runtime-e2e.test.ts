/**
 * Cross-runtime e2e test for pi-co-author.
 *
 * pi-co-author is installed via pi-monorepo-registry (not natively).
 * Tests: install via registry under pi, gsd, and both — verify symlink
 * isolation and that the extension loads with co-author-mode flag + handlers.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	gsdAvailable,
	isSymlinked,
	makeExtensionsDir,
	makeTemp,
	installViaRegistry,
	loadViaPi,
	loadViaGsd,
	nextId,
	resetIds,
} from "../../../shared/test/cross-runtime-helpers.js";

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const pkgName = "pi-co-author";
const registrySrc = path.resolve(__dirname, "../../pi-monorepo-registry/src/index.ts");
const repoRoot = path.resolve(__dirname, "../../..");

resetIds();

// ===========================================================================
// Scenario 1: Install via pi → state in pi only
// ===========================================================================
describe("Scenario 1: Install pi-co-author via pi only", () => {
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-coa-${nextId()}`);
		gsdAgentDir = makeTemp(`gsd-coa-${nextId()}`);
		makeExtensionsDir(piAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("no symlink in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "extensions"), pkgName)).toBe(false);
	});

	it("loads via pi SDK with co-author-mode flag and handlers", async () => {
		const result = await loadViaPi(piAgentDir);
		expect(result.extensionsResult.errors).toHaveLength(0);

		const ext = result.extensionsResult.extensions.find(
			(e: any) => e.flags.has("co-author-mode"),
		);
		expect(ext).toBeDefined();
		expect(ext!.handlers.has("session_start")).toBe(true);
		expect(ext!.handlers.has("tool_call")).toBe(true);
	});
});

// ===========================================================================
// Scenario 2: Install via gsd → state in gsd only
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 2: Install pi-co-author via gsd only", () => {
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-coa-${nextId()}`);
		gsdAgentDir = makeTemp(`gsd-coa-${nextId()}`);
		makeExtensionsDir(gsdAgentDir);

		await installViaRegistry(gsdAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("no symlink in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "extensions"), pkgName)).toBe(false);
	});

	it("loads via gsd SDK with co-author-mode flag and handlers", async () => {
		const result = await loadViaGsd(gsdAgentDir);
		expect(result.extensionsResult.errors).toHaveLength(0);

		const ext = result.extensionsResult.extensions.find(
			(e: any) => e.flags.has("co-author-mode"),
		);
		expect(ext).toBeDefined();
		expect(ext!.handlers.has("session_start")).toBe(true);
		expect(ext!.handlers.has("tool_call")).toBe(true);
	});
});

// ===========================================================================
// Scenario 3: Install in both → state in both, no errors
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 3: Install pi-co-author in both pi and gsd", () => {
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-coa-${nextId()}`);
		gsdAgentDir = makeTemp(`gsd-coa-${nextId()}`);
		makeExtensionsDir(piAgentDir);
		makeExtensionsDir(gsdAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
		await installViaRegistry(gsdAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("symlink in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "extensions"), pkgName)).toBe(true);
	});

	it("pi loads without errors", async () => {
		const result = await loadViaPi(piAgentDir);
		expect(result.extensionsResult.errors).toHaveLength(0);
	});

	it("gsd loads without critical errors", async () => {
		const result = await loadViaGsd(gsdAgentDir);
		const critical = result.extensionsResult.errors.filter(
			(e: any) => !e.error.includes("conflicts with"),
		);
		expect(critical).toHaveLength(0);
	});
});
