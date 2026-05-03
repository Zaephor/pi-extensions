/**
 * Sub-extension loader — discovers and loads extensions from the registry's
 * managed active/ directory using jiti (same TS resolver as pi/gsd runtime).
 *
 * Each extension is loaded by:
 * 1. Reading package.json → pi.extensions to find the entry point
 * 2. Using jiti to import the .ts entry point
 * 3. Calling the default export (factory function) with the real ExtensionAPI
 *
 * Module resolution: jiti resolves bare imports (e.g. @mariozechner/pi-ai)
 * by walking up from the entry point's directory to find node_modules. In a
 * monorepo, node_modules lives at the root, so this works as long as jiti's
 * base URL is the extension's path, not the loader's path.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import jiti from "jiti";
import { ensureNodeModules } from "./deps.js";

/** Information about a discovered extension. */
interface DiscoveredExtension {
	name: string;
	path: string;
	entryPoint: string;
}

/**
 * Find the monorepo root by walking up from a package directory looking
 * for a package-lock.json or lockfile (indicates the npm install root).
 */
function findMonorepoRoot(pkgDir: string): string | undefined {
	let dir = pkgDir;
	for (let i = 0; i < 10; i++) {
		if (existsSync(join(dir, "package-lock.json")) || existsSync(join(dir, "npm-shrinkwrap.json"))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

/**
 * Discover extensions in a directory by scanning for symlinks/dirs with
 * package.json files containing a pi.extensions manifest.
 */
export function discoverActiveExtensions(activeDir: string): DiscoveredExtension[] {
	if (!existsSync(activeDir)) return [];

	const entries = readdirSync(activeDir);
	const discovered: DiscoveredExtension[] = [];

	for (const entry of entries) {
		const entryPath = join(activeDir, entry);
		let resolvedPath = entryPath;

		// Resolve symlinks
		try {
			if (lstatSync(entryPath).isSymbolicLink()) {
				resolvedPath = realpathSync(entryPath);
			}
		} catch {
			continue;
		}

		// Read package.json
		const pkgPath = join(resolvedPath, "package.json");
		if (!existsSync(pkgPath)) continue;

		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			const extensions: string[] = pkg?.pi?.extensions;
			if (!Array.isArray(extensions) || extensions.length === 0) continue;

			// Use the first entry point
			const entryPoint = join(resolvedPath, extensions[0]);
			if (!existsSync(entryPoint)) continue;

			discovered.push({
				name: pkg.name || entry,
				path: resolvedPath,
				entryPoint,
			});
		} catch {}
	}

	return discovered;
}

/**
 * Load extensions from the active/ directory and call their factories with
 * the real ExtensionAPI. Returns load results for diagnostics.
 */
export async function loadActiveExtensions(
	activeDir: string,
	api: ExtensionAPI,
): Promise<{ loaded: string[]; errors: Array<{ name: string; error: string }> }> {
	const discovered = discoverActiveExtensions(activeDir);
	const loaded: string[] = [];
	const errors: Array<{ name: string; error: string }> = [];

	// Ensure node_modules exists at the monorepo root(s).
	// Group extensions by their monorepo root and install once per root.
	const rootsInstalled = new Set<string>();
	for (const ext of discovered) {
		const root = findMonorepoRoot(ext.path);
		if (root && !rootsInstalled.has(root)) {
			try {
				ensureNodeModules(root);
			} catch (err) {
				errors.push({
					name: ext.name,
					error: `npm install failed: ${err instanceof Error ? err.message : String(err)}`,
				});
			}
			rootsInstalled.add(root);
		}
	}

	for (const ext of discovered) {
		try {
			// Create jiti scoped to the extension's directory so bare imports
			// (e.g. @mariozechner/pi-ai) resolve via the monorepo root's node_modules.
			const j = jiti(dirname(ext.entryPoint), {
				interopDefault: true,
				cache: true,
			});

			const mod = j(ext.entryPoint);
			const factory = mod.default ?? mod;

			if (typeof factory !== "function") {
				errors.push({
					name: ext.name,
					error: `Entry point does not export a default function`,
				});
				continue;
			}

			await factory(api);
			loaded.push(ext.name);
		} catch (err) {
			errors.push({
				name: ext.name,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return { loaded, errors };
}
