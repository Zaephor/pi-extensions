/**
 * Persistence — load and save registry state to disk.
 *
 * State is stored as JSON in the agent data directory:
 *   ~/.pi/agent/monorepo-registry/state.json   (when running under pi)
 *   ~/.gsd/agent/monorepo-registry/state.json  (when running under gsd)
 *
 * The path is resolved via getAgentDir() which respects the running binary's
 * configDir setting (PI_PACKAGE_DIR env var → package.json piConfig → fallback to ~/.pi).
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { MonorepoSource, RegistryState } from "./types.js";

/**
 * Resolve the agent directory, falling back gracefully if getAgentDir() fails.
 * This can happen in test environments or unusual loading contexts.
 */
function resolveAgentDir(): string {
	try {
		return getAgentDir();
	} catch {
		// Fallback: use ~/.pi/agent/ as default
		return join(homedir(), ".pi", "agent");
	}
}

/** Get the path to the registry state file. */
export function getStateFilePath(): string {
	return join(resolveAgentDir(), "monorepo-registry", "state.json");
}

/**
 * Load registry state from disk.
 * Returns empty state if no persisted state exists.
 */
export async function loadState(): Promise<RegistryState> {
	const filePath = getStateFilePath();

	if (!existsSync(filePath)) {
		return { sources: [] };
	}

	try {
		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);

		// Basic shape validation
		if (!parsed || !Array.isArray(parsed.sources)) {
			return { sources: [] };
		}

		// Ensure each source has required fields (migrate older state)
		const sources: MonorepoSource[] = parsed.sources.filter(isValidSource).map((s: Record<string, unknown>) => ({
			url: s.url as string,
			shortName: (s.shortName as string) || "",
			packagesRoot: (s.packagesRoot as string) || "packages",
			packages: Array.isArray(s.packages) ? s.packages : [],
			lastUpdated: (s.lastUpdated as string) || new Date().toISOString(),
			rootPath: (s.rootPath as string) || (s.url as string),
		}));

		return { sources };
	} catch {
		return { sources: [] };
	}
}

/**
 * Save registry state to disk.
 * Creates the directory synchronously to avoid async mkdir race conditions.
 */
export async function saveState(state: RegistryState): Promise<void> {
	const filePath = getStateFilePath();

	// Ensure directory exists synchronously (mkdir -p)
	mkdirSync(dirname(filePath), { recursive: true });

	// Serialize — strip non-essential fields from packages to keep file small
	const serializable = {
		sources: state.sources.map((source) => ({
			url: source.url,
			shortName: source.shortName,
			packagesRoot: source.packagesRoot,
			packages: source.packages.map((pkg) => ({
				name: pkg.name,
				description: pkg.description,
				version: pkg.version,
				path: pkg.path,
				isPiPackage: pkg.isPiPackage,
			})),
			lastUpdated: source.lastUpdated,
			rootPath: source.rootPath,
		})),
	};

	await writeFile(filePath, JSON.stringify(serializable, null, "\t"), "utf-8");
}

/** Check if a parsed source object has the minimum required fields. */
function isValidSource(s: unknown): s is Record<string, unknown> {
	return typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).url === "string";
}
