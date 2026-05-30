/**
 * SDK e2e test — uses pi's real SDK to load the pi-co-author extension
 * and verify all registrations and tool_call mutation via createAgentSession + DefaultResourceLoader.
 *
 * This proves the extension works end-to-end with pi's real runtime (jiti),
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

const extensionPath = path.resolve(__dirname, "..", "src", "index.ts");

let tempDir: string;
let extensionsResult: Awaited<ReturnType<typeof createAgentSession>>["extensionsResult"];
let extensionRunner: any;
let toolCallHandler: (event: any, ctx: any) => Promise<void>;
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

	// Access the extension runner to control flag values for mode switching
	extensionRunner = (result.session as any)._extensionRunner;

	// Grab the tool_call handler from the loaded extension
	const ext = extensionsResult.extensions[0];
	const handlers = ext.handlers.get("tool_call");
	toolCallHandler = handlers[0];
});

afterAll(() => {
	if (tempDir) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

/** Create a bash tool_call event for a given command string. */
function bashEvent(command: string) {
	return {
		type: "tool_call",
		toolCallId: `tc-${Date.now()}`,
		toolName: "bash",
		input: { command },
	};
}

/** Minimal context mock for invoking tool_call handler. */
function mockCtx(overrides?: { model?: any }) {
	return {
		ui: { notify: () => {} },
		cwd: process.cwd(),
		model: overrides?.model ?? undefined,
	};
}

describe("SDK e2e — pi-co-author extension via createAgentSession", () => {
	// ─── Extension Loading ──────────────────────────────────────────
	it("loads extension without errors", () => {
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("extension resolves to correct path", () => {
		const matching = extensionsResult.extensions.filter(
			(ext: any) => ext.path.includes("pi-co-author") || ext.resolvedPath.includes("pi-co-author"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});

	// ─── Event & Flag Registration ──────────────────────────────────
	it("subscribes to tool_call event", () => {
		const ext = extensionsResult.extensions[0];
		expect(ext.handlers.has("tool_call")).toBe(true);
		expect(ext.handlers.get("tool_call")).toHaveLength(1);
	});

	it("subscribes to session_start event", () => {
		const ext = extensionsResult.extensions[0];
		expect(ext.handlers.has("session_start")).toBe(true);
	});

	it("registers the co-author-mode flag", () => {
		const ext = extensionsResult.extensions[0];
		const flags = ext.flags as Map<string, any>;
		expect(flags.has("co-author-mode")).toBe(true);
		const flag = flags.get("co-author-mode");
		expect(flag.type).toBe("string");
		expect(flag.default).toBe("single");
	});

	// ─── Tool Call Mutation — single mode (default) ─────────────────
	it("rewrites git commit with single-mode trailer", async () => {
		// Default mode is 'single' — ensure it
		extensionRunner.setFlagValue("co-author-mode", "single");

		const event = bashEvent('git commit -m "fix: typo"');
		await toolCallHandler(event, mockCtx());

		expect(event.input.command).toContain("fix: typo");
		expect(event.input.command).toContain("Co-Authored-By:");
		expect(event.input.command).toContain("noreply@pi.dev");
		// Single mode: one trailer line only (no Generated-By)
		expect(event.input.command).not.toContain("Generated-By:");
	});

	// ─── Tool Call Mutation — split mode ────────────────────────────
	it("rewrites git commit with split-mode trailers", async () => {
		extensionRunner.setFlagValue("co-author-mode", "split");

		const event = bashEvent('git commit -m "feat: new feature"');
		await toolCallHandler(event, mockCtx({ model: { id: "gpt-4o", name: "GPT-4o" } }));

		expect(event.input.command).toContain("feat: new feature");
		expect(event.input.command).toContain("Co-Authored-By:");
		expect(event.input.command).toContain("Generated-By:");
		expect(event.input.command).toContain("noreply@pi.dev");
	});

	// ─── Tool Call Mutation — disabled mode ─────────────────────────
	it("does not rewrite command in disabled mode", async () => {
		extensionRunner.setFlagValue("co-author-mode", "disabled");

		const original = 'git commit -m "chore: cleanup"';
		const event = bashEvent(original);
		await toolCallHandler(event, mockCtx());

		expect(event.input.command).toBe(original);
	});

	// ─── Tool Call Mutation — non-git commands ──────────────────────
	it("does not rewrite non-git commands", async () => {
		extensionRunner.setFlagValue("co-author-mode", "single");

		const original = "npm run build";
		const event = bashEvent(original);
		await toolCallHandler(event, mockCtx());

		expect(event.input.command).toBe(original);
	});

	// ─── Tool Call Mutation — git commit --amend ────────────────────
	it("does not rewrite git commit --amend", async () => {
		extensionRunner.setFlagValue("co-author-mode", "single");

		const original = 'git commit --amend -m "fix: amended"';
		const event = bashEvent(original);
		await toolCallHandler(event, mockCtx());

		expect(event.input.command).toBe(original);
	});
});
