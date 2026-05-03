/**
 * Sub-extension loader — discovers and loads extensions from the registry's
 * managed active/ directory using jiti (same TS resolver as pi/gsd runtime).
 *
 * Each extension is loaded by:
 * 1. Reading package.json → pi.extensions to find the entry point
 * 2. Using jiti to import the .ts entry point
 * 3. Calling the default export (factory function) with the real ExtensionAPI
 *
 * Module resolution: extensions declare @mariozechner/* packages as peerDeps
 * because pi provides them at runtime. We mirror pi's own getAliases() approach
 * — resolving these from pi's running process via import.meta.resolve and
 * passing them as jiti aliases so extensions share pi's module instances.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import jiti from "jiti";

/** Information about a discovered extension. */
interface DiscoveredExtension {
	name: string;
	path: string;
	entryPoint: string;
}

/** A loaded sub-extension with its event handlers for forwarding. */
interface LoadedSubExtension {
	name: string;
	handlers: Map<string, Array<(event: any, ctx: any) => any>>;
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
 * Build jiti alias map for runtime peer dependencies, mirroring pi's own
 * getAliases() approach. Resolves @mariozechner/* and typebox from pi's
 * running process so extensions share the same module instances.
 *
 * import.meta.resolve handles ESM packages correctly (unlike require.resolve).
 */
function buildRuntimeAliases(): Record<string, string> {
	const resolve = (specifier: string): string | undefined => {
		try {
			const url = import.meta.resolve(specifier);
			return url.startsWith("file://") ? fileURLToPath(url) : url;
		} catch {
			return undefined;
		}
	};

	const aliases: Record<string, string> = {};

	// Core pi packages
	for (const mod of [
		"@mariozechner/pi-ai",
		"@mariozechner/pi-ai/oauth",
		"@mariozechner/pi-coding-agent",
		"@mariozechner/pi-tui",
		"@mariozechner/pi-agent-core",
	]) {
		const resolved = resolve(mod);
		if (resolved) aliases[mod] = resolved;
	}

	// Typebox (both import names)
	const typebox = resolve("typebox");
	if (typebox) {
		aliases.typebox = typebox;
		aliases["@sinclair/typebox"] = typebox;
	}
	const typeboxCompile = resolve("typebox/compile");
	if (typeboxCompile) {
		aliases["typebox/compile"] = typeboxCompile;
		aliases["@sinclair/typebox/compile"] = typeboxCompile;
	}
	const typeboxValue = resolve("typebox/value");
	if (typeboxValue) {
		aliases["typebox/value"] = typeboxValue;
		aliases["@sinclair/typebox/value"] = typeboxValue;
	}

	return aliases;
}

/**
 * Load extensions from the active/ directory and call their factories with
 * a proxy API. Sub-extensions can't register event handlers directly with
 * pi's extension runner (they're loaded via jiti, not pi's native loader),
 * so the proxy captures handlers for the registry to forward.
 */
export async function loadActiveExtensions(
	activeDir: string,
	api: ExtensionAPI,
): Promise<{
	loaded: string[];
	errors: Array<{ name: string; error: string }>;
	subExtensions: LoadedSubExtension[];
}> {
	const discovered = discoverActiveExtensions(activeDir);
	const loaded: string[] = [];
	const errors: Array<{ name: string; error: string }> = [];
	const subExtensions: LoadedSubExtension[] = [];

	// Build aliases from pi's runtime so peer deps resolve to pi's own copies
	const runtimeAliases = buildRuntimeAliases();

	for (const ext of discovered) {
		try {
			const j = jiti(dirname(ext.entryPoint), {
				interopDefault: true,
				cache: true,
				alias: runtimeAliases,
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

			// Create a proxy API that captures on() handlers for forwarding.
			// Only proxy the methods sub-extensions typically use; delegate
			// everything else to the real API.
			const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
			const proxyApi = Object.create(api) as ExtensionAPI;
			proxyApi.on = (event: string, handler: any) => {
				const existing = handlers.get(event) ?? [];
				existing.push(handler);
				handlers.set(event, existing);
			};

			await factory(proxyApi);
			loaded.push(ext.name);
			subExtensions.push({ name: ext.name, handlers });
		} catch (err) {
			errors.push({
				name: ext.name,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return { loaded, errors, subExtensions };
}
