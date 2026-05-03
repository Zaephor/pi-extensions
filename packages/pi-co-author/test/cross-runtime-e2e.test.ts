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
	installViaRegistry,
	isSymlinked,
	loadViaGsd,
	loadViaPi,
	makeActiveDir,
	makeTemp,
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
		const flags = new Map();
		const handlers = new Map();
		const mockApi = {
			registerFlag: (n: string, o: any) => flags.set(n, o),
			on: (e: string, h: any) => {
				const l = handlers.get(e) || [];
				l.push(h);
				handlers.set(e, l);
			},
			registerCommand: () => {},
			registerTool: () => {},
			registerShortcut: () => {},
			getFlag: () => undefined,
			appendEntry: () => {},
		} as any;

		const activeDir = path.join(piAgentDir, "monorepo-registry", "active");
		const result = await loadActiveExtensions(activeDir, mockApi);
		expect(result.errors).toHaveLength(0);
		expect(result.loaded).toContain("pi-co-author");
		expect(flags.has("co-author-mode")).toBe(true);
		// Event handlers are captured by the loader's proxy API, not the test mock
		expect(result.subExtensions.length).toBeGreaterThan(0);
		const subExt = result.subExtensions.find((s: any) => s.name === "pi-co-author");
		expect(subExt).toBeDefined();
		expect(subExt.handlers.has("session_start")).toBe(true);
		expect(subExt.handlers.has("tool_call")).toBe(true);
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
		const flags = new Map();
		const handlers = new Map();
		const mockApi = {
			registerFlag: (n: string, o: any) => flags.set(n, o),
			on: (e: string, h: any) => {
				const l = handlers.get(e) || [];
				l.push(h);
				handlers.set(e, l);
			},
			registerCommand: () => {},
			registerTool: () => {},
			registerShortcut: () => {},
			getFlag: () => undefined,
			appendEntry: () => {},
		} as any;

		const activeDir = path.join(gsdAgentDir, "monorepo-registry", "active");
		const { loaded, errors } = await loadActiveExtensions(activeDir, mockApi);
		expect(errors).toHaveLength(0);
		expect(loaded).toContain("pi-co-author");
		expect(flags.has("co-author-mode")).toBe(true);
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
