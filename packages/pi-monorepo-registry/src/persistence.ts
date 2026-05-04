/**
 * Persistence — load and save registry state to disk.
 *
 * State is stored as JSON at ~/.<agent>/monorepo/state.json
 * Path resolution is centralized in paths.ts — this module just reads/writes.
 *
 * The RegistryState shape includes `installedPackages` (added in M006).
 * Older state files that lack this field are migrated automatically.
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getStateFilePath } from "./paths.js";
import type { InstalledPackage, MonorepoSource, RegistryState } from "./types.js";

/**
 * Load registry state from disk.
 * Returns empty state if no persisted state exists or if the file is corrupted.
 * Migrates older state files that don't have `installedPackages`.
 */
export async function loadState(): Promise<RegistryState> {
	const filePath = getStateFilePath();

	if (!existsSync(filePath)) {
		return { sources: [], installedPackages: [] };
	}

	try {
		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);

		// Basic shape validation
		if (!parsed || !Array.isArray(parsed.sources)) {
			return { sources: [], installedPackages: [] };
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

		// Migrate installedPackages — default to empty array for older state files
		const installedPackages: InstalledPackage[] = Array.isArray(parsed.installedPackages)
			? parsed.installedPackages.filter(isValidInstalledPackage)
			: [];

		return { sources, installedPackages };
	} catch {
		return { sources: [], installedPackages: [] };
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
		installedPackages: state.installedPackages.map((pkg) => ({
			name: pkg.name,
			sourceUrl: pkg.sourceUrl,
			activationMode: pkg.activationMode,
			installedAt: pkg.installedAt,
			targetPath: pkg.targetPath,
			extensionDir: pkg.extensionDir,
		})),
	};

	await writeFile(filePath, JSON.stringify(serializable, null, "\t"), "utf-8");
}

/** Check if a parsed source object has the minimum required fields. */
function isValidSource(s: unknown): s is Record<string, unknown> {
	return typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).url === "string";
}

/** Check if a parsed installedPackage object has the minimum required fields. */
function isValidInstalledPackage(p: unknown): p is Record<string, unknown> {
	if (typeof p !== "object" || p === null) return false;
	const obj = p as Record<string, unknown>;
	return typeof obj.name === "string" && typeof obj.targetPath === "string";
}
