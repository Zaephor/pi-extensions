/**
 * Paths — single source of truth for all filesystem paths used by the registry.
 *
 * Resolves the agent base directory once from getAgentDir() (which respects
 * the running binary: pi → ~/.pi, gsd → ~/.gsd) and derives all sub-paths
 * from it. Every module should use these functions instead of calling
 * getAgentDir() directly.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

/** Resolve the agent directory, falling back to ~/.pi/agent on failure. */
function resolveAgentDir(): string {
	try {
		return getAgentDir();
	} catch {
		return join(homedir(), ".pi", "agent");
	}
}

/** The base directory for all registry-managed paths (e.g. ~/.gsd/agent or ~/.pi/agent). */
let _baseDir: string | undefined;

/** Get the resolved agent base directory, computing once on first access. */
export function getRegistryBaseDir(): string {
	if (!_baseDir) {
		_baseDir = resolveAgentDir();
	}
	return _baseDir;
}

/** Reset the cached base dir (for testing). */
export function resetRegistryBaseDir(): void {
	_baseDir = undefined;
}

/** Path to the registry's data directory: <base>/monorepo-registry/ */
export function getRegistryDir(): string {
	return join(getRegistryBaseDir(), "monorepo-registry");
}

/** Path to the persisted state file: <base>/monorepo-registry/state.json */
export function getStateFilePath(): string {
	return join(getRegistryDir(), "state.json");
}

/** Path to the clone cache directory: <base>/monorepo-registry/sources/ */
export function getCloneCacheDir(): string {
	return join(getRegistryDir(), "sources");
}

/** Path to the active extensions directory for a given scope. */
export function getExtensionsDir(scope: "global" | "local", cwd?: string): string {
	if (scope === "local") {
		const base = cwd ?? process.cwd();
		return join(base, "monorepo-registry", "active");
	}
	return join(getRegistryDir(), "active");
}
