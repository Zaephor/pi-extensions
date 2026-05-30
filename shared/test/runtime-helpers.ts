/**
 * Shared helpers for e2e tests against the pi runtime.
 *
 * Architecture:
 *   - pi-monorepo-registry is installed natively by pi (root pi.extensions manifest).
 *   - All other packages are installed via /monorepo-package install through the registry.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

/** Resolve a path within a monorepo package from the shared test directory. */
function resolveMonorepoPackagePath(pkg: string, subpath: string): string {
	// shared/test/runtime-helpers.ts -> monorepo root
	const thisDir = path.dirname(fileURLToPath(import.meta.url));
	const monorepoRoot = path.resolve(thisDir, "../..");
	return path.join(monorepoRoot, "packages", pkg, subpath);
}

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
	const linkPath = path.join(extensionsDir, packageNameToDirName(name));
	if (!existsSync(linkPath)) return false;
	try {
		return lstatSync(linkPath).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * Create the extensions directory that getExtensionsDir() resolves to.
 * agentDir must follow pattern <tempDir>/.pi/agent so dirname gives <tempDir>/.pi
 * and monorepo resolves to <tempDir>/.pi/monorepo/extensions/.
 */
export function makeExtensionsDir(agentDir: string): string {
	const extDir = path.join(path.dirname(agentDir), "monorepo", "extensions");
	mkdirSync(extDir, { recursive: true });
	return extDir;
}

/**
 * Get the extensions directory path for a given agent dir.
 * Mirrors the logic in paths.ts: dirname(agentDir)/monorepo/extensions/
 */
export function getExtensionsDirFor(agentDir: string): string {
	return path.join(path.dirname(agentDir), "monorepo", "extensions");
}

/**
 * Convert a package name to a filesystem-safe directory name.
 * Mirrors packages.ts: packageNameToDirName.
 */
export function packageNameToDirName(packageName: string): string {
	return packageName.replace(/\//g, "-");
}

// ---------------------------------------------------------------------------
// Agent dir isolation
// ---------------------------------------------------------------------------
/** Override agent dir resolution for the duration of fn, then restore. */
export async function withAgentDir<T>(agentDir: string, fn: () => Promise<T>): Promise<T> {
	const saved = process.env.PI_PACKAGE_DIR;
	delete process.env.PI_PACKAGE_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	// Reset the registry's cached base dir so it re-resolves with the new env var
	try {
		const pathsMod = await import(
			/* @vite-ignore */
			resolveMonorepoPackagePath("pi-monorepo-registry", "src/paths.js")
		);
		if (pathsMod.resetRegistryBaseDir) pathsMod.resetRegistryBaseDir();
	} catch {
		// paths module not available in this context
	}
	try {
		return await fn();
	} finally {
		delete process.env.PI_CODING_AGENT_DIR;
		if (saved) process.env.PI_PACKAGE_DIR = saved;
		try {
			const pathsMod = await import(
				/* @vite-ignore */
				resolveMonorepoPackagePath("pi-monorepo-registry", "src/paths.js")
			);
			if (pathsMod.resetRegistryBaseDir) pathsMod.resetRegistryBaseDir();
		} catch {
			// paths module not available in this context
		}
	}
}

// ---------------------------------------------------------------------------
// SDK loader
// ---------------------------------------------------------------------------
/** Load extensions via pi SDK from an agent dir (discovers from extensions/). */
export async function loadViaPi(agentDir: string) {
	const { createAgentSession, DefaultResourceLoader, SessionManager } = await import(
		"@earendil-works/pi-coding-agent"
	);
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
 * Loads the registry extension with a mock API, registers the monorepo source
 * via /monorepo-registry add, then installs package via /monorepo-package install --dev.
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

		const mod = await import(/* @vite-ignore */ registrySrc);
		await mod.default(mock.api);

		// Register this monorepo as a source via /monorepo-registry add
		const regCmd = mock.commands.get("monorepo-registry")!;
		await regCmd.handler(`add ${repoRoot} packages`, mock.ctx);

		// Install the target package via /monorepo-package install --dev (symlink to local)
		const pkgDir = path.join(repoRoot, "packages", packageNameToDirName(packageName));
		const pkgCmd = mock.commands.get("monorepo-package")!;
		await pkgCmd.handler(`install ${packageName} --dev ${pkgDir}`, mock.ctx);
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
