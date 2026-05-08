/**
 * SDK e2e test — uses pi's real SDK to load the pi-duckduckgo extension
 * and verify tool registration via createAgentSession + DefaultResourceLoader.
 *
 * This proves the extension works end-to-end with pi's real runtime
 * (loaded through jiti), not just with recording mocks.
 *
 * pi-duckduckgo is a tool-only extension — no command or event assertions.
 * Tool execute calls real searchDdg which uses globalThis.fetch; we mock
 * globalThis.fetch before calling execute to avoid live network calls.
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

beforeAll(async () => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-duckduckgo-e2e-"));

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

describe("SDK e2e — pi-duckduckgo extension via createAgentSession", () => {
	it("loads extension without errors", () => {
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers the duckduckgo_search tool", () => {
		let tool: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("duckduckgo_search")) {
				tool = ext.tools.get("duckduckgo_search");
				break;
			}
		}
		expect(tool).not.toBeNull();
		expect(tool.definition.name).toBe("duckduckgo_search");
		expect(tool.definition.label).toBe("DuckDuckGo Search");
		expect(tool.definition.description).toContain("DuckDuckGo");
	});

	it("tool has parameter schema with required 'query'", () => {
		let schema: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("duckduckgo_search")) {
				schema = ext.tools.get("duckduckgo_search")!.definition.parameters;
				break;
			}
		}
		expect(schema).not.toBeNull();
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("query");
		expect(schema.properties).toBeDefined();
		expect(schema.properties.query.type).toBe("string");
	});

	it("tool execute returns content with mock fetch", async () => {
		let toolDef: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("duckduckgo_search")) {
				toolDef = ext.tools.get("duckduckgo_search")!.definition;
				break;
			}
		}
		expect(toolDef).not.toBeNull();

		// Mock globalThis.fetch — SDK e2e loads through jiti so tool execute
		// will call real searchDdg which calls globalThis.fetch
		const originalFetch = globalThis.fetch;
		let callCount = 0;
		globalThis.fetch = (async (url: string, _opts?: any) => {
			callCount++;
			if (url.includes("html.duckduckgo.com")) {
				return new Response('some html vqd=e2e-token-123&more', { status: 200 });
			}
			if (url.includes("links.duckduckgo.com")) {
				return new Response(
					JSON.stringify({
						Results: [
							{ t: "E2E Result", u: "https://e2e.test", a: "E2E snippet" },
						],
					}),
					{ status: 200 },
				);
			}
			return new Response("not found", { status: 404 });
		}) as any;

		try {
			const result = await toolDef.execute(
				"test-call-id",
				{ query: "e2e test" },
				undefined,
				undefined,
				// Minimal mock context — tool only uses params, not ctx
				{ ui: { notify: () => {} }, cwd: process.cwd() } as any,
			);

			expect(result.content).toBeDefined();
			expect(result.content[0].type).toBe("text");
			expect(result.content[0].text).toContain("E2E Result");
			expect(callCount).toBeGreaterThanOrEqual(2); // vqd + search
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("extension resolves to path containing 'pi-duckduckgo'", () => {
		const matching = extensionsResult.extensions.filter(
			(ext) => ext.path.includes("pi-duckduckgo") || ext.resolvedPath.includes("pi-duckduckgo"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
