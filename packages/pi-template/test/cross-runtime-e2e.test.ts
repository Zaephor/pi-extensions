/**
 * Cross-runtime e2e test for pi-template.
 *
 * pi-template is installed via pi-monorepo-registry (not natively).
 * Tests: install via registry under pi, gsd, and both — verify symlink
 * isolation and that the extension loads with hello tool + greet command.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	gsdAvailable,
	installViaRegistry,
	isSymlinked,
	loadViaGsd,
	loadViaPi,
	makeActiveDir,
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
		makeActiveDir(piAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "monorepo-registry/active"), pkgName)).toBe(true);
	});

	it("no symlink in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "monorepo-registry/active"), pkgName)).toBe(false);
	});

	it("registry can load extension from active/ dir", async () => {
		const { loadActiveExtensions } = await import(path.resolve(__dirname, "../../pi-monorepo-registry/src/loader.ts"));
		const tools = new Map();
		const commands = new Map();
		const mockApi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerCommand: (n: string, o: any) => commands.set(n, o),
			registerFlag: () => {},
			on: () => {},
			registerShortcut: () => {},
			getFlag: () => undefined,
			appendEntry: () => {},
		} as any;

		const activeDir = path.join(piAgentDir, "monorepo-registry", "active");
		const { loaded, errors } = await loadActiveExtensions(activeDir, mockApi);
		expect(errors).toHaveLength(0);
		expect(loaded).toContain("pi-template");
		expect(tools.has("hello")).toBe(true);
		expect(commands.has("greet")).toBe(true);
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
		makeActiveDir(gsdAgentDir);

		await installViaRegistry(gsdAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "monorepo-registry/active"), pkgName)).toBe(true);
	});

	it("no symlink in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "monorepo-registry/active"), pkgName)).toBe(false);
	});

	it("registry can load extension from active/ dir", async () => {
		const { loadActiveExtensions } = await import(path.resolve(__dirname, "../../pi-monorepo-registry/src/loader.ts"));
		const tools = new Map();
		const commands = new Map();
		const mockApi = {
			registerTool: (t: any) => tools.set(t.name, t),
			registerCommand: (n: string, o: any) => commands.set(n, o),
			registerFlag: () => {},
			on: () => {},
			registerShortcut: () => {},
			getFlag: () => undefined,
			appendEntry: () => {},
		} as any;

		const activeDir = path.join(gsdAgentDir, "monorepo-registry", "active");
		const { loaded, errors } = await loadActiveExtensions(activeDir, mockApi);
		expect(errors).toHaveLength(0);
		expect(loaded).toContain("pi-template");
		expect(tools.has("hello")).toBe(true);
		expect(commands.has("greet")).toBe(true);
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
		makeActiveDir(piAgentDir);
		makeActiveDir(gsdAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
		await installViaRegistry(gsdAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		expect(isSymlinked(path.join(piAgentDir, "monorepo-registry/active"), pkgName)).toBe(true);
	});

	it("symlink in gsd agent dir", () => {
		expect(isSymlinked(path.join(gsdAgentDir, "monorepo-registry/active"), pkgName)).toBe(true);
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
