/**
 * Package discovery — walks directories to find pi-compatible packages.
 *
 * A package is considered discoverable when its package.json contains either:
 * - A `pi` field with an `extensions` array, OR
 * - The keyword `pi-package` in its keywords array.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PackageInfo } from "./types.js";

/**
 * Discover pi-compatible packages in a monorepo directory.
 *
 * Walks the immediate subdirectories of `packagesRoot` (default: "packages")
 * under `monorepoRoot`, looking for package.json files that match pi-package
 * criteria.
 *
 * @param monorepoRoot - Absolute path to the monorepo root.
 * @param packagesRoot - Relative subdirectory containing packages (default: "packages").
 * @returns Array of discovered PackageInfo entries.
 */
export async function discoverPackages(monorepoRoot: string, packagesRoot = "packages"): Promise<PackageInfo[]> {
	const fullPackagesPath = join(monorepoRoot, packagesRoot);
	const results: PackageInfo[] = [];

	let entries: string[];
	try {
		entries = await readdir(fullPackagesPath);
	} catch {
		// Directory doesn't exist or isn't readable — return empty
		return results;
	}

	for (const entry of entries) {
		const entryPath = join(fullPackagesPath, entry);
		let entryStat: Awaited<ReturnType<typeof stat>> | undefined;
		try {
			entryStat = await stat(entryPath);
		} catch {
			continue;
		}

		if (!entryStat.isDirectory()) {
			continue;
		}

		const pkgJsonPath = join(entryPath, "package.json");
		let raw: string;
		try {
			raw = await readFile(pkgJsonPath, "utf-8");
		} catch {
			continue;
		}

		let pkg: Record<string, unknown>;
		try {
			pkg = JSON.parse(raw);
		} catch {
			continue;
		}

		const isPiPackage = isPiCompatible(pkg);
		if (!isPiPackage) {
			continue;
		}

		results.push({
			name: typeof pkg.name === "string" ? pkg.name : entry,
			description: typeof pkg.description === "string" ? pkg.description : "",
			version: typeof pkg.version === "string" ? pkg.version : "0.0.0",
			path: entryPath,
			isPiPackage,
		});
	}

	return results;
}

/**
 * Check if a parsed package.json qualifies as a pi-compatible package.
 */
export function isPiCompatible(pkg: Record<string, unknown>): boolean {
	// Check for pi.extensions array
	const pi = pkg.pi as Record<string, unknown> | undefined;
	if (pi && Array.isArray(pi.extensions)) {
		return true;
	}

	// Check for pi-package keyword
	const keywords = pkg.keywords;
	if (Array.isArray(keywords) && keywords.includes("pi-package")) {
		return true;
	}

	return false;
}
