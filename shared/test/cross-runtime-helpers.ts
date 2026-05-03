/**
 * Shared helpers for cross-runtime e2e tests.
 *
 * Architecture:
 *   - pi-monorepo-registry is installed natively by pi/gsd (root pi.extensions manifest)
 *   - All other packages are installed via /monorepo-install through the registry
 *
 * GSD tests are skipped unless gsd-pi is resolvable.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// ---------------------------------------------------------------------------
// GSD SDK resolution
// ---------------------------------------------------------------------------
let gsdApi: any = null;
try {
	gsdApi = await import("@gsd/pi-coding-agent");
} catch {
	try {
		gsdApi = await import("gsd-pi/packages/pi-coding-agent/dist/index.js");
	} catch {}
}
export const gsdAvailable = gsdApi !== null;
export { gsdApi };

// ---------------------------------------------------------------------------
// Temp dir lifecycle
// ---------------------------------------------------------------------------
const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

export function makeTemp(prefix: string): string {
	const dir = mkdtempSync(path.join(os.tmpdir(), `xrt-${prefix}-`));
	tempDirs.push(dir);
	return dir;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------
export function isSymlinked(extensionsDir: string, name: string): boolean {
	const linkPath = path.join(extensionsDir, name);
	if (!existsSync(linkPath)) return false;
	try {
		return lstatSync(linkPath).isSymbolicLink();
	} catch {
		return false;
	}
}

export function makeExtensionsDir(agentDir: string): string {
	const extDir = path.join(agentDir, "extensions");
	mkdirSync(extDir, { recursive: true });
	return extDir;
}

// ---------------------------------------------------------------------------
// Agent dir isolation
// ---------------------------------------------------------------------------
/** Override agent dir resolution for the duration of fn, then restore. */
export async function withAgentDir<T>(agentDir: string, fn: () => Promise<T>): Promise<T> {
	const saved = process.env.PI_PACKAGE_DIR;
	delete process.env.PI_PACKAGE_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		return await fn();
	} finally {
		delete process.env.PI_CODING_AGENT_DIR;
		if (saved) process.env.PI_PACKAGE_DIR = saved;
	}
}

// ---------------------------------------------------------------------------
// SDK loaders
// ---------------------------------------------------------------------------
/** Load extensions via pi SDK from an agent dir (discovers from extensions/). */
export async function loadViaPi(agentDir: string) {
	const { createAgentSession, DefaultResourceLoader, SessionManager } = await import("@mariozechner/pi-coding-agent");
	const loader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir,
		noExtensions: false,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		cwd: process.cwd(),
	});
}

/** Load extensions via gsd SDK from an agent dir. */
export async function loadViaGsd(agentDir: string) {
	const { createAgentSession, DefaultResourceLoader, SessionManager } = gsdApi!;
	const loader = new DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir,
		noExtensions: false,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return createAgentSession({
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		cwd: process.cwd(),
	});
}

// ---------------------------------------------------------------------------
// Registry install helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock ExtensionAPI that captures registerCommand calls.
 * Used to drive registry commands programmatically.
 */
function createRegistryMock() {
	const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();

	const api = {
		registerCommand(name: string, opts: any) {
			commands.set(name, { handler: opts.handler });
		},
		registerTool: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		on: () => {},
		appendEntry: () => {},
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
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
	} as any;

	const ctx = {
		ui: { notify: () => {} },
		hasUI: true,
		cwd: process.cwd(),
		sessionManager: {},
		modelRegistry: {},
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

	return { api, commands, ctx };
}

/**
 * Install a package via the registry into an agent dir.
 * Loads the registry extension with a mock API, registers the monorepo source,
 * then runs /monorepo-install for the target package.
 *
 * @param registrySrc - Absolute path to pi-monorepo-registry/src/index.ts
 * @param repoRoot - Absolute path to the monorepo root (containing packages/)
 */
export async function installViaRegistry(
	agentDir: string,
	packageName: string,
	registrySrc: string,
	repoRoot: string,
): Promise<void> {
	await withAgentDir(agentDir, async () => {
		const mock = createRegistryMock();

		const mod = await import(registrySrc);
		await mod.default(mock.api);

		// Register this monorepo as a source
		const regCmd = mock.commands.get("monorepo-registry")!;
		await regCmd.handler(`add ${repoRoot} packages`, mock.ctx);

		// Install the target package
		const installCmd = mock.commands.get("monorepo-install")!;
		await installCmd.handler(packageName, mock.ctx);
	});
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------
let counter = 0;
export function nextId(): string {
	return `s${++counter}`;
}
export function resetIds(): void {
	counter = 0;
}
