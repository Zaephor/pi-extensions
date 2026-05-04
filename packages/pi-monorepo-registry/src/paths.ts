/**
 * Paths — single source of truth for all filesystem paths used by the registry.
 *
 * Agent-scoped layout (per D026 — global only, no local scope):
 *
 *   ~/.<agent>/monorepo/              ← getMonorepoDir()
 *   ├── extensions/                   ← getExtensionsDir()
 *   ├── git/                          ← getGitDir()
 *   └── state.json                    ← getStateFilePath()
 *
 *   ~/.<agent>/agent/settings.json    ← getSettingsFilePath()
 *
 * Where ~/<agent>/ is determined by getAgentDir() which respects
 * the running binary (pi → ~/.pi, gsd → ~/.gsd).
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

/** Resolve the agent directory, falling back to ~/.pi/agent on failure. */
function resolveAgentDir(): string {
	try {
		return getAgentDir();
	} catch {
		return join(homedir(), ".pi", "agent");
	}
}

/** The cached agent base directory (e.g. ~/.gsd/agent or ~/.pi/agent). */
let _baseDir: string | undefined;

/** Get the resolved agent base directory, computing once on first access. Backward-compatible alias. */
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

/** Path to the monorepo directory: ~/.<agent>/monorepo/ */
export function getMonorepoDir(): string {
	return join(dirname(getRegistryBaseDir()), "monorepo");
}

/** Path to the extensions directory: ~/.<agent>/monorepo/extensions/ */
export function getExtensionsDir(): string {
	return join(getMonorepoDir(), "extensions");
}

/** Path to the git clone cache directory: ~/.<agent>/monorepo/git/ */
export function getGitDir(): string {
	return join(getMonorepoDir(), "git");
}

/** Path to the persisted state file: ~/.<agent>/monorepo/state.json */
export function getStateFilePath(): string {
	return join(getMonorepoDir(), "state.json");
}

/** Path to the agent settings file: ~/.<agent>/agent/settings.json */
export function getSettingsFilePath(): string {
	return join(getRegistryBaseDir(), "settings.json");
}
