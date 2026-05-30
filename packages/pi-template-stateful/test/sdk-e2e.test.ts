/**
 * SDK e2e test — uses pi's real SDK to load the pi-template-stateful
 * extension and verify all registrations via createAgentSession +
 * DefaultResourceLoader.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = path.resolve(__dirname, "..", "src", "index.ts");

let tempDir: string;
let extensionsResult: Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"];

beforeAll(async () => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-stateful-e2e-"));

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
});

afterAll(() => {
	if (tempDir) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

describe("SDK e2e — pi-template-stateful via createAgentSession", () => {
	it("loads extension without errors", () => {
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers the counter tool", () => {
		let tool: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("counter")) {
				tool = ext.tools.get("counter");
				break;
			}
		}
		expect(tool).not.toBeNull();
		expect(tool.definition.name).toBe("counter");
	});

	it("tool has valid parameter schema with action enum", () => {
		let schema: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("counter")) {
				schema = ext.tools.get("counter")!.definition.parameters;
				break;
			}
		}
		expect(schema).not.toBeNull();
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("action");
		expect(schema.properties.action).toBeDefined();
	});

	it("tool execute increments and records details", async () => {
		let toolDef: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("counter")) {
				toolDef = ext.tools.get("counter")!.definition;
				break;
			}
		}
		expect(toolDef).not.toBeNull();

		const result = await toolDef.execute("test-call-id", { action: "increment" }, undefined, undefined, {
			ui: { notify: () => {} },
			cwd: process.cwd(),
		} as any);

		expect(result.content[0].text).toMatch(/Counter is now \d+\./);
		expect((result.details as any).count).toBeGreaterThanOrEqual(1);
	});

	it("registers the /counter command", () => {
		let cmd: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.commands.has("counter")) {
				cmd = ext.commands.get("counter");
				break;
			}
		}
		expect(cmd).not.toBeNull();
		expect(cmd.name).toBe("counter");
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

	it("extension resolves to the right package", () => {
		const matching = extensionsResult.extensions.filter(
			(ext) => ext.path.includes("pi-template-stateful") || ext.resolvedPath.includes("pi-template-stateful"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
