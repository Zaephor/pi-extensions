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

	it("subscribes to tool_call event", () => {
		let found = false;
		for (const ext of extensionsResult.extensions) {
			if (ext.handlers.has("tool_call")) {
				found = true;
				break;
			}
		}
		expect(found).toBe(true);
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

	it("registers the co-author-mode flag", () => {
		let found = false;
		for (const ext of extensionsResult.extensions) {
			if (ext.flags instanceof Map) {
				if (ext.flags.has("co-author-mode")) {
					found = true;
					break;
				}
			} else if (Array.isArray(ext.flags)) {
				if (ext.flags.some((f: any) => f.name === "co-author-mode")) {
					found = true;
					break;
				}
			}
		}
		expect(found).toBe(true);
	});

	it("extension resolves to correct path", () => {
		const matching = extensionsResult.extensions.filter(
			(ext: any) => ext.path.includes("pi-co-author") || ext.resolvedPath.includes("pi-co-author"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
