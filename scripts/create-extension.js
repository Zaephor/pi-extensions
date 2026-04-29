#!/usr/bin/env node

/**
 * create-extension — Scaffold a new pi extension package.
 *
 * Usage: node scripts/create-extension.js <name>
 *
 * Generates packages/<name>/ with all boilerplate files derived from
 * pi-template, updates root configs atomically, and cleans up on failure.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate an extension name: non-empty, valid npm package name segment,
 * not "pi-template", and the target directory must not already exist.
 */
function validateName(name) {
	if (!name || name.trim().length === 0) {
		return "Extension name is required.";
	}
	// Valid npm package name segment: lowercase, hyphens allowed, no leading dot/underscore
	if (/^[._]/.test(name)) {
		return 'Extension name must not start with "." or "_".';
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		return "Extension name must be lowercase alphanumeric with hyphens (e.g. my-tool).";
	}
	if (name === "pi-template") {
		return 'Cannot use reserved name "pi-template".';
	}
	const pkgDir = resolve(rootDir, "packages", name);
	if (existsSync(pkgDir)) {
		return `Directory packages/${name}/ already exists.`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

/** Capitalize first letter of the extension name for the tool label. */
function toolLabel(name) {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function generatePackageJson(name) {
	return `${JSON.stringify(
		{
			name: `${name}`,
			version: "0.1.0",
			type: "module",
			keywords: ["pi-package"],
			files: ["src"],
			main: "./src/index.ts",
			pi: {
				extensions: ["./src/index.ts"],
			},
			scripts: {
				build: "echo 'nothing to build'",
				check: "tsc --noEmit",
				test: "vitest run",
			},
			peerDependencies: {
				"@mariozechner/pi-coding-agent": "*",
				"@mariozechner/pi-ai": "*",
				"@mariozechner/pi-agent-core": "*",
				"@mariozechner/pi-tui": "*",
				typebox: "*",
			},
			devDependencies: {
				"@mariozechner/pi-coding-agent": "^0.70.0",
				"@mariozechner/pi-ai": "^0.70.0",
				"@mariozechner/pi-agent-core": "^0.70.0",
				"@mariozechner/pi-tui": "^0.70.0",
				typebox: "^1.1.0",
			},
		},
		null,
		"\t",
	)}\n`;
}

function generateTsconfigJson() {
	return `${JSON.stringify(
		{
			extends: "../../shared/tsconfig.base.json",
			compilerOptions: {
				composite: true,
				rootDir: "src",
				outDir: "dist",
			},
			include: ["src"],
			exclude: ["node_modules", "dist"],
		},
		null,
		"\t",
	)}\n`;
}

function generateSrcIndex(name) {
	const label = toolLabel(name);
	return `/**
 * ${name} — A pi extension.
 */

import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const ${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Tool = defineTool({
	name: "${name}",
	label: "${label}",
	description: "A pi extension",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
		return {
			content: [{ type: "text" as const, text: "${name} executed" }],
			details: {},
		};
	},
});

export default function (pi: ExtensionAPI) {
	// Register the ${name} tool
	pi.registerTool(${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Tool);

	// Subscribe to session_start event
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("${name} extension loaded ✅", "info");
	});
}
`;
}

function generateReadme(name) {
	return `# ${name}

A pi extension.

## Installation

\`\`\`sh
pi install git:github.com/Zaephor/pi-extensions
/monorego-install ${name}
/reload
\`\`\`


## Usage

The \`${name}\` tool is invoked automatically by the LLM when relevant.

### session_start notification

When a session begins, the extension prints:

\`\`\`
${name} extension loaded ✅
\`\`\`

## Development

Clone the monorepo and install dependencies from the root:

\`\`\`sh
git clone https://github.com/Zaephor/pi-extensions.git
cd pi-extensions
npm install
\`\`\`

Available scripts in this package:

| Command | Description |
|---------|-------------|
| \`npm run check\` | Type-check with \`tsc --noEmit\` |
| \`npm test\` | Run all tests with Vitest |

From the monorepo root you can also run:

\`\`\`sh
npm run typecheck   # type-check all packages
npm run check       # lint all files with Biome
npm run test        # run all tests
npm run check:all   # typecheck + lint + test
\`\`\`

## Testing

Run tests from the root or from \`packages/${name}\`:

\`\`\`sh
npm test
\`\`\`

The test suite has five tiers:

| Tier | File | What it verifies |
|------|------|------------------|
| Unit | \`test/unit.test.ts\` | Tool handler in isolation |
| Integration | \`test/integration.test.ts\` | Factory function registers extensions correctly |
| Package shape | \`test/package-shape.test.ts\` | \`package.json\` has required pi manifest fields |
| SDK e2e | \`test/sdk-e2e.test.ts\` | Full pi runtime loads the extension |
| Index | \`test/index.test.ts\` | Re-exports and entry point validation |
`;
}

function generateMockApi() {
	return `/**
 * Reusable mock for ExtensionAPI, capturing registerTool/registerCommand/on calls
 * so unit tests can assert on what the extension registered.
 */
import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@mariozechner/pi-coding-agent";

/** A single captured tool registration. */
export interface CapturedTool {
	tool: ToolDefinition;
}

/** A single captured command registration. */
export interface CapturedCommand {
	name: string;
	description?: string;
	handler: (args: string, ctx: any) => Promise<void> | void;
}

/** A single captured event subscription. */
export interface CapturedEvent {
	event: string;
	handler: ExtensionHandler<any, any>;
}

/** Minimal mock context passed to command/event handlers during tests. */
export function createMockContext(overrides?: Partial<{ notify: (...args: any[]) => void }>) {
	return {
		ui: {
			notify: overrides?.notify ?? (() => {}),
		},
		hasUI: true,
		cwd: "/tmp",
		sessionManager: {} as any,
		modelRegistry: {} as any,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

/**
 * Create a mock ExtensionAPI that records all registrations.
 *
 * Usage:
 *   const { api, tools, commands, events } = createMockAPI();
 *   extensionFactory(api);
 *   expect(tools).toHaveLength(1);
 */
export function createMockAPI() {
	const tools: CapturedTool[] = [];
	const commands: CapturedCommand[] = [];
	const events: CapturedEvent[] = [];

	const api = {
		registerTool(tool: ToolDefinition) {
			tools.push({ tool });
		},

		registerCommand(name: string, options: any) {
			commands.push({
				name,
				description: options.description,
				handler: options.handler,
			});
		},

		on(event: string, handler: ExtensionHandler<any, any>) {
			events.push({ event, handler });
		},

		// Stubs for the rest of ExtensionAPI — not needed for unit tests
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
		getActiveTools: () => [] as string[],
		getAllTools: () => [] as any[],
		setActiveTools: () => {},
		getCommands: () => [] as any[],
		setModel: async () => false,
		getThinkingLevel: () => "none" as any,
		setThinkingLevel: () => {},
		registerProvider: () => {},
	} as unknown as ExtensionAPI;

	return { api, tools, commands, events };
}
`;
}

function generateIndexTest(name) {
	return `import { describe, expect, it } from "vitest";

describe("${name}", () => {
	it("should export a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});
});
`;
}

function generateUnitTest(name) {
	const _camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	const label = toolLabel(name);
	return `import { describe, expect, it, vi } from "vitest";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

describe("${name} extension", () => {
	it("should export a factory function as default", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});

	describe("tool registration", () => {
		it("registers exactly one tool", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools).toHaveLength(1);
		});

		it("registers the ${name} tool with correct name and label", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const tool = tools[0].tool;
			expect(tool.name).toBe("${name}");
			expect(tool.label).toBe("${label}");
		});

		it("has a non-empty description", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools[0].tool.description.length).toBeGreaterThan(0);
		});

		it("tool execute returns result", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const result = await tools[0].tool.execute("tc1", {}, undefined, undefined, createMockContext() as any);
			expect(result.content).toEqual([{ type: "text", text: "${name} executed" }]);
			expect(result.details).toEqual({});
		});
	});

	describe("event registration", () => {
		it("registers exactly one event handler", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			expect(events).toHaveLength(1);
		});

		it("subscribes to session_start", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			expect(events[0].event).toBe("session_start");
		});

		it("session_start handler notifies that extension loaded", async () => {
			const mod = await import("../src/index.js");
			const { api, events } = createMockAPI();
			mod.default(api);
			const notify = vi.fn();
			const ctx = createMockContext({ notify });
			await events[0].handler({}, ctx as any);
			expect(notify).toHaveBeenCalledWith("${name} extension loaded ✅", "info");
		});
	});
});
`;
}

function generateIntegrationTest(name) {
	const label = toolLabel(name);
	const _camelName = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	return `/**
 * Integration tests — verify full extension loading via dynamic import.
 *
 * These tests differ from unit tests by using Map-based recording mocks
 * (mirroring pi's actual Extension interface shape) and validating the
 * complete initialization path end-to-end.
 */

import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

/**
 * Create a recording mock that stores registrations in Maps,
 * matching the shape pi uses internally.
 */
function createRecordingMock() {
	const tools = new Map<string, ToolDefinition>();
	const commands = new Map<
		string,
		{ description?: string; handler: (args: string, ctx: any) => Promise<void> | void }
	>();
	const handlers = new Map<string, Function[]>();

	const api = {
		registerTool(tool: ToolDefinition) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, { description: options.description, handler: options.handler });
		},
		on(event: string, handler: ExtensionHandler<any, any>) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},

		// Stubs for remaining ExtensionAPI surface
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
		getActiveTools: () => [] as string[],
		getAllTools: () => [] as any[],
		setActiveTools: () => {},
		getCommands: () => [] as any[],
		setModel: async () => false,
		getThinkingLevel: () => "none" as any,
		setThinkingLevel: () => {},
		registerProvider: () => {},
	} as unknown as ExtensionAPI;

	return { api, tools, commands, handlers };
}

/** Minimal context for invoking handlers in tests. */
function testContext(notify?: (...args: any[]) => void) {
	return {
		ui: { notify: notify ?? (() => {}) },
		hasUI: true,
		cwd: "/tmp",
		sessionManager: {} as any,
		modelRegistry: {} as any,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

describe("${name} integration — full extension loading", () => {
	it("dynamically imports the module and gets a factory function", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
		expect(mod.default.length).toBe(1); // expects one argument: ExtensionAPI
	});

	it("factory initializes without errors and populates all Maps", async () => {
		const mod = await import("../src/index.js");
		const { api, tools, handlers } = createRecordingMock();
		mod.default(api);

		expect(tools.size).toBe(1);
		expect(handlers.size).toBe(1);
	});

	describe("tool registration via Map", () => {
		it("registers the '${name}' tool in the tools Map", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			expect(tools.has("${name}")).toBe(true);
			const tool = tools.get("${name}")!;
			expect(tool.name).toBe("${name}");
			expect(tool.label).toBe("${label}");
		});

		it("tool has a valid parameter schema", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("${name}")!;
			const schema = tool.parameters;

			expect(schema.type).toBe("object");
		});

		it("tool execute returns correct result", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("${name}")!;
			const result = await tool.execute("tc1", {}, undefined, undefined, testContext() as any);

			expect(result.content).toEqual([{ type: "text", text: "${name} executed" }]);
			expect(result.details).toEqual({});
		});
	});

	describe("event registration via Map", () => {
		it("registers session_start handler in the handlers Map", async () => {
			const mod = await import("../src/index.js");
			const { api, handlers } = createRecordingMock();
			mod.default(api);

			expect(handlers.has("session_start")).toBe(true);
			expect(handlers.get("session_start")!).toHaveLength(1);
		});

		it("session_start handler notifies extension loaded", async () => {
			const mod = await import("../src/index.js");
			const { api, handlers } = createRecordingMock();
			mod.default(api);

			const notified: any[] = [];
			const ctx = testContext((...args: any[]) => notified.push(args));
			const [handler] = handlers.get("session_start")!;
			await handler({}, ctx as any);

			expect(notified).toEqual([["${name} extension loaded ✅", "info"]]);
		});
	});

	describe("cross-concern integration", () => {
		it("factory is idempotent — calling twice doubles registrations", async () => {
			const mod = await import("../src/index.js");
			const { api, tools, handlers } = createRecordingMock();

			mod.default(api);
			mod.default(api);

			expect(tools.size).toBe(1); // same key overwrites
			expect(handlers.get("session_start")!).toHaveLength(2); // on() appends
		});

		it("full round-trip: import → factory → tool execute produces output", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createRecordingMock();
			mod.default(api);

			const tool = tools.get("${name}")!;
			const result = await tool.execute("tc-roundtrip", {}, undefined, undefined, testContext() as any);

			expect(result.content[0].text).toBe("${name} executed");
		});
	});
});
`;
}

function generatePackageShapeTest(name) {
	return `/**
 * Package shape tests — verify npm pack produces a correct tarball.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");

let tmpDir: string | undefined;

afterAll(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

interface PackEntry {
	name: string;
	version: string;
	filename: string;
	files: Array<{ path: string; size: number }>;
}

async function npmPack(): Promise<PackEntry> {
	tmpDir = mkdtempSync(join(tmpdir(), "${name}-pack-"));

	const { stdout } = await execFileAsync("npm", ["pack", "--json"], {
		cwd: pkgDir,
		encoding: "utf-8",
	});

	const entries = JSON.parse(stdout);
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error(\`Unexpected npm pack output: \${stdout}\`);
	}
	return entries[0];
}

function readPkgJson(): Record<string, unknown> {
	const raw = readFileSync(join(pkgDir, "package.json"), "utf-8");
	return JSON.parse(raw);
}

describe("package shape", () => {
	describe("package.json fields", () => {
		it('includes "files" allowlist containing src', () => {
			const pkg = readPkgJson();
			expect(pkg.files).toBeDefined();
			expect(Array.isArray(pkg.files)).toBe(true);
			expect(pkg.files).toContain("src");
		});

		it("has pi-package keyword", () => {
			const pkg = readPkgJson();
			expect(pkg.keywords).toBeDefined();
			expect(Array.isArray(pkg.keywords)).toBe(true);
			expect(pkg.keywords).toContain("pi-package");
		});

		it("has pi.extensions manifest", () => {
			const pkg = readPkgJson();
			expect(pkg.pi).toBeDefined();
			const pi = pkg.pi as Record<string, unknown>;
			expect(pi.extensions).toBeDefined();
			expect(Array.isArray(pi.extensions)).toBe(true);
			expect((pi.extensions as string[]).length).toBeGreaterThan(0);
		});

		it("has peerDependencies", () => {
			const pkg = readPkgJson();
			expect(pkg.peerDependencies).toBeDefined();
			expect(typeof pkg.peerDependencies).toBe("object");
			expect(Object.keys(pkg.peerDependencies as object).length).toBeGreaterThan(0);
		});
	});

	describe("tarball contents", () => {
		let result: PackEntry;
		let filePaths: string[];

		beforeAll(async () => {
			result = await npmPack();
			filePaths = result.files.map((f) => f.path);
		});

		it("includes src/index.ts", () => {
			expect(filePaths).toContain("src/index.ts");
		});

		it("includes package.json", () => {
			expect(filePaths).toContain("package.json");
		});

		it("includes README.md", () => {
			expect(filePaths).toContain("README.md");
		});

		it("excludes test/ files", () => {
			const testFiles = filePaths.filter((p) => p.startsWith("test/"));
			expect(testFiles).toEqual([]);
		});

		it("excludes node_modules/", () => {
			const nmFiles = filePaths.filter((p) => p.includes("node_modules"));
			expect(nmFiles).toEqual([]);
		});

		it("excludes dist/", () => {
			const distFiles = filePaths.filter((p) => p.startsWith("dist/"));
			expect(distFiles).toEqual([]);
		});

		it("excludes .tsbuildinfo files", () => {
			const tsbFiles = filePaths.filter((p) => p.endsWith(".tsbuildinfo"));
			expect(tsbFiles).toEqual([]);
		});
	});
});
`;
}

function generateSdkE2eTest(name) {
	return `/**
 * SDK e2e test — uses pi's real SDK to load the ${name} extension
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
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "${name}-e2e-"));

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

describe("SDK e2e — ${name} extension via createAgentSession", () => {
	it("loads extension without errors", () => {
		expect(extensionsResult.errors).toHaveLength(0);
		expect(extensionsResult.extensions.length).toBeGreaterThanOrEqual(1);
	});

	it("registers the ${name} tool", () => {
		let foundTool: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("${name}")) {
				foundTool = ext.tools.get("${name}");
				break;
			}
		}
		expect(foundTool).not.toBeNull();
		expect(foundTool.definition.name).toBe("${name}");
		expect(foundTool.definition.label).toBe("${toolLabel(name)}");
	});

	it("tool execute returns correct result", async () => {
		let toolDef: any = null;
		for (const ext of extensionsResult.extensions) {
			if (ext.tools.has("${name}")) {
				toolDef = ext.tools.get("${name}")!.definition;
				break;
			}
		}
		expect(toolDef).not.toBeNull();

		const result = await toolDef.execute("test-call-id", {}, undefined, undefined, {
			ui: { notify: () => {} },
			cwd: process.cwd(),
		} as any);

		expect(result.content).toEqual([{ type: "text", text: "${name} executed" }]);
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
			(ext) => ext.path.includes("${name}") || ext.resolvedPath.includes("${name}"),
		);
		expect(matching.length).toBeGreaterThanOrEqual(1);
	});
});
`;
}

/**
 * Read and parse a JSON file, retrying briefly if the read fails or returns
 * invalid content. Handles concurrent writers that may leave transient bad state.
 */
function readJsonWithRetry(filePath, retries = 5, delayMs = 50) {
	for (let i = 0; i < retries; i++) {
		try {
			const content = readFileSync(filePath, "utf-8").trim();
			if (!content.startsWith("{") && !content.startsWith("[")) {
				throw new Error(`File does not start with valid JSON: ${content.slice(0, 40)}`);
			}
			return JSON.parse(content);
		} catch (err) {
			if (i === retries - 1) throw err;
			// Brief pause before retry — concurrent writer may be mid-update
			const end = Date.now() + delayMs;
			while (Date.now() < end) {}
		}
	}
}

/**
 * Atomically write a JSON file: write to a temp file in the same directory,
 * then rename over the target. Prevents concurrent readers from seeing
 * partial writes.
 */
function writeJsonAtomic(filePath, data) {
	const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmpPath, `${JSON.stringify(data, null, "\t")}\n`, "utf-8");
	renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Root config updaters
// ---------------------------------------------------------------------------

function updateRootTsconfig(name) {
	const tsconfigPath = resolve(rootDir, "tsconfig.json");
	const tsconfig = readJsonWithRetry(tsconfigPath);
	const ref = { path: `packages/${name}` };
	if (!tsconfig.references.some((r) => r.path === ref.path)) {
		tsconfig.references.push(ref);
	}
	writeJsonAtomic(tsconfigPath, tsconfig);
	console.log(`Updated tsconfig.json with packages/${name} reference`);
}

function updateReleaseManifest(name) {
	const manifestPath = resolve(rootDir, ".release-please-manifest.json");
	const manifest = readJsonWithRetry(manifestPath);
	manifest[`packages/${name}`] = "0.1.0";
	writeJsonAtomic(manifestPath, manifest);
	console.log(`Updated .release-please-manifest.json with packages/${name}`);
}

function updateRootPackageJson() {
	const pkgPath = resolve(rootDir, "package.json");
	const pkg = readJsonWithRetry(pkgPath);
	if (!pkg.scripts["create-extension"]) {
		pkg.scripts["create-extension"] = "node scripts/create-extension.js";
	}
	writeJsonAtomic(pkgPath, pkg);
	console.log('Updated package.json with "create-extension" script');
}

// ---------------------------------------------------------------------------
// File writer with logging
// ---------------------------------------------------------------------------

function writeFile(filePath, content) {
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, content, "utf-8");
	console.log(`Creating ${filePath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	const name = process.argv[2];

	if (!name) {
		console.error("Usage: node scripts/create-extension.js <name>");
		process.exit(1);
	}

	const error = validateName(name);
	if (error) {
		console.error(error);
		process.exit(1);
	}

	const pkgDir = resolve(rootDir, "packages", name);

	try {
		// Generate all package files
		writeFile(resolve(pkgDir, "package.json"), generatePackageJson(name));
		writeFile(resolve(pkgDir, "tsconfig.json"), generateTsconfigJson());
		writeFile(resolve(pkgDir, "src", "index.ts"), generateSrcIndex(name));
		writeFile(resolve(pkgDir, "README.md"), generateReadme(name));
		writeFile(resolve(pkgDir, "test", "helpers", "mock-api.ts"), generateMockApi());
		writeFile(resolve(pkgDir, "test", "index.test.ts"), generateIndexTest(name));
		writeFile(resolve(pkgDir, "test", "unit.test.ts"), generateUnitTest(name));
		writeFile(resolve(pkgDir, "test", "integration.test.ts"), generateIntegrationTest(name));
		writeFile(resolve(pkgDir, "test", "package-shape.test.ts"), generatePackageShapeTest(name));
		writeFile(resolve(pkgDir, "test", "sdk-e2e.test.ts"), generateSdkE2eTest(name));

		// Update root configs
		updateRootTsconfig(name);
		updateReleaseManifest(name);
		updateRootPackageJson();

		console.log(`\n✅ Extension ${name} created successfully!`);
		console.log(`   Directory: packages/${name}/`);
	} catch (err) {
		console.error(`\n❌ Failed to create extension: ${err.message}`);
		// Clean up partial output
		if (existsSync(pkgDir)) {
			console.error(`Cleaning up packages/${name}/...`);
			rmSync(pkgDir, { recursive: true, force: true });
		}
		process.exit(1);
	}
}

main();
