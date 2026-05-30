/**
 * SDK e2e test — uses pi's real SDK to load the pi-template extension
 * and verify all registrations via createAgentSession + DefaultResourceLoader.
 *
 * This proves the extension works end-to-end with pi's real runtime,
 * not just with recording mocks.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to the extension's entry point
const extensionPath = path.resolve(__dirname, "..", "src", "index.ts");

let tempDir: string;
let extensionsResult: Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"];
let _modelFallbackMessage: string | undefined;

beforeAll(async () => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-e2e-"));

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

describe("SDK e2e — pi-template extension via createAgentSession", () => {
	it("loads extension without errors", () => {
		// modelFallbackMessage is expected (no API keys in test env), not an extension error
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers the hello tool", () => {
		let helloTool: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("hello")) {
				helloTool = ext.tools.get("hello");
				break;
			}
		}
		expect(helloTool).not.toBeNull();
		expect(helloTool.definition.name).toBe("hello");
		expect(helloTool.definition.label).toBe("Hello");
		expect(helloTool.definition.description).toBe("Greet someone by name");
	});

	it("tool has valid parameter schema", () => {
		let schema: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("hello")) {
				schema = ext.tools.get("hello")!.definition.parameters;
				break;
			}
		}
		expect(schema).not.toBeNull();
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("name");
		expect(schema.properties).toBeDefined();
		expect(schema.properties.name.type).toBe("string");
	});

	it("tool execute returns correct greeting", async () => {
		let toolDef: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("hello")) {
				toolDef = ext.tools.get("hello")!.definition;
				break;
			}
		}
		expect(toolDef).not.toBeNull();

		const result = await toolDef.execute(
			"test-call-id",
			{ name: "SDK" },
			undefined,
			undefined,
			// Minimal mock context — tool only uses params, not ctx
			{ ui: { notify: () => {} }, cwd: process.cwd() } as any,
		);

		expect(result.content).toEqual([{ type: "text", text: "Hello, SDK!" }]);
		expect(result.details).toEqual({});
	});

	it("registers the greet command", () => {
		let greetCmd: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.commands.has("greet")) {
				greetCmd = ext.commands.get("greet");
				break;
			}
		}
		expect(greetCmd).not.toBeNull();
		expect(greetCmd.name).toBe("greet");
		expect(greetCmd.description).toBeTruthy();
		expect(typeof greetCmd.handler).toBe("function");
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

	it("extension resolves to correct path", () => {
		const matching = extensionsResult.extensions.filter(
			(ext) => ext.path.includes("pi-template") || ext.resolvedPath.includes("pi-template"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
