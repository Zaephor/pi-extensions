/**
 * SDK e2e test — uses pi's real SDK to load the pi-monorepo-registry extension
 * and verify registrations via createAgentSession + DefaultResourceLoader.
 *
 * This proves the extension works end-to-end with pi's real runtime (jiti),
 * not just with recording mocks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to the extension's entry point
const extensionPath = path.resolve(__dirname, "..", "src", "index.ts");

let tempDir: string;
let extensionsResult: Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"];
let _modelFallbackMessage: string | undefined;

beforeAll(async () => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-monorepo-registry-e2e-"));

	const resourceLoader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: tempDir,
		additionalExtensionPaths: [extensionPath],
		noExtensions: false,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});

	await resourceLoader.reload();

	const result = await createAgentSession({
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		cwd: process.cwd(),
	});

	extensionsResult = result.extensionsResult;
	_modelFallbackMessage = result.modelFallbackMessage;
});

afterAll(() => {
	if (tempDir) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("SDK e2e — pi-monorepo-registry extension via createAgentSession", () => {
	it("loads extension without errors", () => {
		// modelFallbackMessage is expected (no API keys in test env), not an extension error
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("extension resolves to correct path", () => {
		const matching = extensionsResult.extensions.filter(
			(ext) => ext.path.includes("pi-monorepo-registry") || ext.resolvedPath.includes("pi-monorepo-registry"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});

	it("registers the monorego-registry command", () => {
		let cmd: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.commands.has("monorego-registry")) {
				cmd = ext.commands.get("monorego-registry");
				break;
			}
		}
		expect(cmd).not.toBeNull();
		expect(cmd.name).toBe("monorego-registry");
		expect(cmd.description).toBeTruthy();
		expect(cmd.description.toLowerCase()).toContain("registry");
		expect(typeof cmd.handler).toBe("function");
	});

	it("subscribes to session_start event", () => {
		let found = false;
		for (const ext of extensionsResult.extensions) {
			if (ext.handlers.has("session_start")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
	});

	it("registers exactly one command", () => {
		let totalCommands = 0;
		for (const ext of extensionsResult.extensions) {
			totalCommands += ext.commands.size;
		}
		expect(totalCommands).toBe(1);
	});
});

/**
 * Reload cycle test — simulates the symlink activation and removal flow.
 *
 * UAT criteria 4 & 6: After activation (symlink) and reload, pi-template's tools/commands
 * are available. After removal and reload, they are gone.
 *
 * This uses pi's real extension discovery (collectAutoExtensionEntries) which follows
 * symlinks in agentDir/extensions/ and reads package.json pi manifests — the same path
 * that /reload triggers in production.
 */
describe("SDK e2e — reload cycle (symlink activation and removal)", () => {
	const piTemplateDir = path.resolve(__dirname, "..", "..", "pi-template");
	let reloadTempDir: string;

	beforeEach(() => {
		reloadTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-reload-cycle-"));
	});

	afterEach(() => {
		if (reloadTempDir) {
			fs.rmSync(reloadTempDir, { recursive: true, force: true });
		}
	});

	it("discovers and loads pi-template via symlink in agentDir/extensions/", async () => {
		// Create the extensions directory in the temp agentDir
		const extensionsDir = path.join(reloadTempDir, "extensions");
		fs.mkdirSync(extensionsDir);

		// Simulate activation: create symlink → pi-template package directory
		const symlinkPath = path.join(extensionsDir, "pi-template");
		fs.symlinkSync(piTemplateDir, symlinkPath);

		// Simulate /reload: create a session that discovers from agentDir
		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: reloadTempDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();

		const result = await createAgentSession({
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		// Verify pi-template loaded successfully
		expect(result.extensionsResult.errors).toHaveLength(0);

		const allTools: Map<string, any> = new Map();
		const allCommands: Map<string, any> = new Map();
		for (const ext of result.extensionsResult.extensions) {
			for (const [name, tool] of ext.tools) {
				allTools.set(name, tool);
			}
			for (const [name, cmd] of ext.commands) {
				allCommands.set(name, cmd);
			}
		}

		// UAT criterion 4: pi-template's hello tool and /greet command are available
		expect(allTools.has("hello")).toBe(true);
		expect(allTools.get("hello").definition.name).toBe("hello");
		expect(allTools.get("hello").definition.label).toBe("Hello");

		expect(allCommands.has("greet")).toBe(true);
		expect(allCommands.get("greet").name).toBe("greet");
		expect(typeof allCommands.get("greet").handler).toBe("function");

		// Verify the tool actually works
		const helloTool = allTools.get("hello").definition;
		const toolResult = await helloTool.execute("test-call-id", { name: "Reload" }, undefined, undefined, {
			ui: { notify: () => {} },
			cwd: process.cwd(),
		} as any);
		expect(toolResult.content).toEqual([{ type: "text", text: "Hello, Reload!" }]);
	});

	it("removes pi-template after symlink deletion and reload", async () => {
		// Create the extensions directory and symlink
		const extensionsDir = path.join(reloadTempDir, "extensions");
		fs.mkdirSync(extensionsDir);

		const symlinkPath = path.join(extensionsDir, "pi-template");
		fs.symlinkSync(piTemplateDir, symlinkPath);

		// First load — pi-template should be present
		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: reloadTempDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader.reload();

		const firstResult = await createAgentSession({
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		// Confirm pi-template was loaded initially
		let foundInitially = false;
		for (const ext of firstResult.extensionsResult.extensions) {
			if (ext.tools.has("hello") || ext.commands.has("greet")) {
				foundInitially = true;
				break;
			}
		}
		expect(foundInitially).toBe(true);

		// Simulate removal: delete the symlink
		fs.unlinkSync(symlinkPath);
		expect(fs.existsSync(symlinkPath)).toBe(false);

		// Simulate /reload: create a new session after removal
		const resourceLoader2 = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: reloadTempDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await resourceLoader2.reload();

		const secondResult = await createAgentSession({
			resourceLoader: resourceLoader2,
			sessionManager: SessionManager.inMemory(),
			cwd: process.cwd(),
		});

		// UAT criterion 6: after /reload, pi-template should be gone
		expect(secondResult.extensionsResult.errors).toHaveLength(0);

		for (const ext of secondResult.extensionsResult.extensions) {
			expect(ext.tools.has("hello")).toBe(false);
			expect(ext.commands.has("greet")).toBe(false);
		}
	});
});
