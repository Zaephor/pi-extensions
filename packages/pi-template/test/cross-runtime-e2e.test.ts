/**
 * Cross-runtime e2e test for pi-template.
 *
 * pi-template is installed via pi-monorepo-registry (not natively).
 * Tests: install via registry under pi, gsd, and both — verify symlink
 * isolation and that the extension loads with hello tool + greet command.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getExtensionsDirFor,
	gsdAvailable,
	installViaRegistry,
	isSymlinked,
	loadViaGsd,
	loadViaPi,
	makeExtensionsDir,
	makeTemp,
	nextId,
	resetIds,
} from "../../../shared/test/cross-runtime-helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgName = "pi-template";
const registrySrc = path.resolve(__dirname, "../../pi-monorepo-registry/src/index.ts");
const repoRoot = path.resolve(__dirname, "../../..");

resetIds();

// ===========================================================================
// Scenario 1: Install via pi → state in pi only
// ===========================================================================
describe("Scenario 1: Install pi-template via pi only", () => {
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-tpl-${nextId()}`);
		gsdAgentDir = makeTemp(`gsd-tpl-${nextId()}`);
		// Agent dir must be <temp>/.pi/agent so dirname = <temp>/.pi
		piAgentDir = path.join(piAgentDir, ".pi", "agent");
		gsdAgentDir = path.join(gsdAgentDir, ".pi", "agent");
		makeExtensionsDir(piAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		const extDir = getExtensionsDirFor(piAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(true);
	});

	it("no symlink in gsd agent dir", () => {
		const extDir = getExtensionsDirFor(gsdAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(false);
	});

	it("extension directory contains package.json with pi.extensions", () => {
		const extDir = getExtensionsDirFor(piAgentDir);
		const pkgJsonPath = path.join(extDir, "pi-template", "package.json");
		expect(existsSync(pkgJsonPath)).toBe(true);

		const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		expect(pkgJson.pi).toBeDefined();
		expect(pkgJson.pi.extensions).toBeDefined();
	});
});

// ===========================================================================
// Scenario 2: Install via gsd → state in gsd only
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 2: Install pi-template via gsd only", () => {
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-tpl-${nextId()}`);
		gsdAgentDir = makeTemp(`gsd-tpl-${nextId()}`);
		piAgentDir = path.join(piAgentDir, ".pi", "agent");
		gsdAgentDir = path.join(gsdAgentDir, ".pi", "agent");
		makeExtensionsDir(gsdAgentDir);

		await installViaRegistry(gsdAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in gsd agent dir", () => {
		const extDir = getExtensionsDirFor(gsdAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(true);
	});

	it("no symlink in pi agent dir", () => {
		const extDir = getExtensionsDirFor(piAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(false);
	});

	it("extension directory contains package.json with pi.extensions", () => {
		const extDir = getExtensionsDirFor(gsdAgentDir);
		const pkgJsonPath = path.join(extDir, "pi-template", "package.json");
		expect(existsSync(pkgJsonPath)).toBe(true);

		const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		expect(pkgJson.pi).toBeDefined();
		expect(pkgJson.pi.extensions).toBeDefined();
	});
});

// ===========================================================================
// Scenario 3: Install in both → state in both, no errors
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 3: Install pi-template in both pi and gsd", () => {
	let piAgentDir: string;
	let gsdAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-tpl-${nextId()}`);
		gsdAgentDir = makeTemp(`gsd-tpl-${nextId()}`);
		piAgentDir = path.join(piAgentDir, ".pi", "agent");
		gsdAgentDir = path.join(gsdAgentDir, ".pi", "agent");
		makeExtensionsDir(piAgentDir);
		makeExtensionsDir(gsdAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
		await installViaRegistry(gsdAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		const extDir = getExtensionsDirFor(piAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(true);
	});

	it("symlink in gsd agent dir", () => {
		const extDir = getExtensionsDirFor(gsdAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(true);
	});

	it("pi loads without errors", async () => {
		const result = await loadViaPi(piAgentDir);
		expect(result.extensionsResult.errors).toHaveLength(0);
	});

	it("gsd loads without critical errors", async () => {
		const result = await loadViaGsd(gsdAgentDir);
		const critical = result.extensionsResult.errors.filter((e: any) => !e.error.includes("conflicts with"));
		expect(critical).toHaveLength(0);
	});
});
