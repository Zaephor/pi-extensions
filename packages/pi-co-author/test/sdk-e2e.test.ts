/**
 * SDK e2e test — uses pi's real SDK to load the pi-co-author extension
 * and verify all registrations via createAgentSession + DefaultResourceLoader.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = path.resolve(__dirname, "..", "src", "index.ts");

let tempDir: string;
let extensionsResult: Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"];
let _modelFallbackMessage: string | undefined;

beforeAll(async () => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-co-author-e2e-"));

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

describe("SDK e2e — pi-co-author extension via createAgentSession", () => {
	it("loads extension without errors", () => {
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers the pi-co-author tool", () => {
		let foundTool: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("pi-co-author")) {
				foundTool = ext.tools.get("pi-co-author");
				break;
			}
		}
		expect(foundTool).not.toBeNull();
		expect(foundTool.definition.name).toBe("pi-co-author");
		expect(foundTool.definition.label).toBe("Pi-co-author");
	});

	it("tool execute returns correct result", async () => {
		let toolDef: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("pi-co-author")) {
				toolDef = ext.tools.get("pi-co-author")!.definition;
				break;
			}
		}
		expect(toolDef).not.toBeNull();

		const result = await toolDef.execute("test-call-id", {}, undefined, undefined, {
			ui: { notify: () => {} },
			cwd: process.cwd(),
		} as any);

		expect(result.content).toEqual([{ type: "text", text: "pi-co-author executed" }]);
		expect(result.details).toEqual({});
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
			(ext) => ext.path.includes("pi-co-author") || ext.resolvedPath.includes("pi-co-author"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
