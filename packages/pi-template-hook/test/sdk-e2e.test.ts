/**
 * SDK e2e test — load pi-template-hook via the real pi SDK and verify the
 * tool_call handler is wired up.
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
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-hook-e2e-"));

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

describe("SDK e2e — pi-template-hook via createAgentSession", () => {
	it("loads extension without errors", () => {
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers no tools and no slash commands (background-only)", () => {
		let totalTools = 0;
		let totalCommands = 0;
		for (const ext of extensionsResult.extensions) {
			if (!ext.path.includes("pi-template-hook") && !ext.resolvedPath.includes("pi-template-hook")) continue;
			totalTools += ext.tools.size;
			totalCommands += ext.commands.size;
		}
		expect(totalTools).toBe(0);
		expect(totalCommands).toBe(0);
	});

	it("subscribes to tool_call and session_start events", () => {
		let hasToolCall = false;
		let hasSessionStart = false;
		for (const ext of extensionsResult.extensions) {
			if (!ext.path.includes("pi-template-hook") && !ext.resolvedPath.includes("pi-template-hook")) continue;
			if (ext.handlers.has("tool_call")) hasToolCall = true;
			if (ext.handlers.has("session_start")) hasSessionStart = true;
		}
		expect(hasToolCall).toBe(true);
		expect(hasSessionStart).toBe(true);
	});

	it("extension resolves to the right package", () => {
		const matching = extensionsResult.extensions.filter(
			(ext) => ext.path.includes("pi-template-hook") || ext.resolvedPath.includes("pi-template-hook"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
