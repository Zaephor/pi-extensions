/**
 * Cross-runtime e2e test for pi-monorepo-registry.
 *
 * pi-monorepo-registry is the only package installed natively by pi/gsd
 * (referenced from root package.json pi.extensions). All other packages
 * are installed through it via the settings.json bridge (S02+).
 *
 * This test verifies:
 * 1. The registry loads natively via pi SDK and registers /monorepo-registry
 * 2. The registry loads natively via gsd SDK and registers /monorepo-registry
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	gsdAvailable,
	type loadViaPi,
	makeTemp,
	nextId,
	resetIds,
} from "../../../shared/test/cross-runtime-helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registrySrc = path.resolve(__dirname, "../src/index.ts");

resetIds();

// ===========================================================================
// Scenario 1: Load registry natively via pi SDK
// ===========================================================================
describe("Scenario 1: Load registry via pi SDK", () => {
	let result: Awaited<ReturnType<typeof loadViaPi>>;

	beforeAll(async () => {
		const agentDir = makeTemp(`pi-reg-${nextId()}`);
		const { DefaultResourceLoader, createAgentSession, SessionManager } = await import("@mariozechner/pi-coding-agent");
		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir,
			additionalExtensionPaths: [registrySrc],
			noExtensions: false,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		result = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});
	});

	it("loads without errors", () => {
		expect(result.extensionsResult.errors).toHaveLength(0);
		expect(result.extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers /monorepo-registry command", () => {
		const has = result.extensionsResult.extensions.some((ext: any) => ext.commands.has("monorepo-registry"));
		expect(has).toBe(true);
	});

	it("registers /monorepo-package command", () => {
		const has = result.extensionsResult.extensions.some((ext: any) => ext.commands.has("monorepo-package"));
		expect(has).toBe(true);
	});
});

// ===========================================================================
// Scenario 2: Load registry natively via gsd SDK
// ===========================================================================
describe.skipIf(!gsdAvailable)("Scenario 2: Load registry via gsd SDK", () => {
	let result: any;

	beforeAll(async () => {
		const agentDir = makeTemp(`gsd-reg-${nextId()}`);
		const { DefaultResourceLoader, createAgentSession, SessionManager } = gsdAvailable
			? await import("gsd-pi/packages/pi-coding-agent/dist/index.js").then((m) => ({
					DefaultResourceLoader: m.DefaultResourceLoader,
					createAgentSession: m.createAgentSession,
					SessionManager: m.SessionManager,
				}))
			: ({} as any);

		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir,
			additionalExtensionPaths: [registrySrc],
			noExtensions: false,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		result = await createAgentSession({
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});
	});

	it("loads without errors", () => {
		expect(result.extensionsResult.errors).toHaveLength(0);
		expect(result.extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers /monorepo-registry command", () => {
		const ext = result.extensionsResult.extensions.find((e: any) => e.commands.has("monorepo-registry"));
		expect(ext).toBeDefined();
	});

	it("registers /monorepo-package command", () => {
		const ext = result.extensionsResult.extensions.find((e: any) => e.commands.has("monorepo-package"));
		expect(ext).toBeDefined();
	});
});
