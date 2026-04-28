/**
 * pi-monorepo-registry — Discover and manage packages across monorepo sources.
 *
 * Provides slash commands for listing discovered packages, installing packages
 * from registered monorepos, removing packages, and managing registry sources.
 * Registry state transitions are recorded in session history via pi.appendEntry().
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createActivationSymlink, removeActivationSymlink } from "./activation.js";
import { ensureNodeModules } from "./deps.js";
import { ENTRY_TYPES, MonorepoRegistry } from "./registry.js";
import type { RegistryState, Scope } from "./types.js";

export { discoverPackages, isPiCompatible } from "./discovery.js";
export { MonorepoRegistry } from "./registry.js";
export type { MonorepoSource, PackageInfo, RegistryState } from "./types.js";

/** Default initial registry state (no sources). */
const EMPTY_STATE: RegistryState = { sources: [] };

export default function (pi: ExtensionAPI) {
	// Registry state lives in-memory for the session
	const registry = new MonorepoRegistry(pi, { ...EMPTY_STATE, sources: [] });

	// --- /monorepo-list: list all registered monorepos and their discovered packages ---
	pi.registerCommand("monorepo-list", {
		description: "List all registered monorepos and their discovered packages",
		handler: async (_args, ctx) => {
			const sources = registry.getSources();

			if (sources.length === 0) {
				ctx.ui.notify("No monorepo sources registered. Use /monorepo-registry add <url> to add one.", "info");
				return;
			}

			const lines: string[] = ["Registered monorepo sources:", ""];

			for (const source of sources) {
				lines.push(`📦 ${source.url}`);
				lines.push(`   packages-root: ${source.packagesRoot}`);
				lines.push(`   last updated: ${source.lastUpdated}`);

				if (source.packages.length === 0) {
					lines.push("   (no packages discovered)");
				} else {
					for (const pkg of source.packages) {
						const desc = pkg.description ? ` — ${pkg.description}` : "";
						lines.push(`   • ${pkg.name}@${pkg.version}${desc}`);
					}
				}

				lines.push("");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// --- /monorepo-install: install a package from a registered monorepo ---
	pi.registerCommand("monorepo-install", {
		description: "Install a package from a registered monorepo (usage: /monorepo-install <source>/<package> [-l])",
		handler: async (args, ctx) => {
			const rawArgs = args.trim();
			if (!rawArgs) {
				ctx.ui.notify("Usage: /monorepo-install <source>/<package> [-l]", "error");
				return;
			}

			// Parse optional -l flag for local scope
			const localFlag = rawArgs.includes("-l");
			const scope: Scope = localFlag ? "local" : "global";
			const cleanedArgs = rawArgs.replace(/\s*-l\s*/, "").trim();

			if (!cleanedArgs) {
				ctx.ui.notify("Usage: /monorepo-install <source>/<package> [-l]", "error");
				return;
			}

			const sources = registry.getSources();
			if (sources.length === 0) {
				ctx.ui.notify(
					"No monorepo sources registered. Use /monorepo-registry add <url> to register one first.",
					"error",
				);
				return;
			}

			let packageName: string;
			let sourceUrl: string | undefined;

			// Check if args contain source/package format (contains /)
			// Distinguish from:
			//  - scoped package names like @scope/pkg (starts with @)
			//  - absolute paths like /tmp/some/pkg (starts with /)
			// Only treat as source/package when it looks like "source-alias/pkg-name"
			if (cleanedArgs.includes("/") && !cleanedArgs.startsWith("@") && !cleanedArgs.startsWith("/")) {
				const slashIdx = cleanedArgs.indexOf("/");
				const sourcePart = cleanedArgs.substring(0, slashIdx);
				packageName = cleanedArgs.substring(slashIdx + 1);
				sourceUrl = sourcePart;

				// Validate source is registered
				const source = registry.findSource(sourceUrl);
				if (!source) {
					ctx.ui.notify(
						`Source "${sourceUrl}" is not registered. Use /monorepo-registry add to register it, or /monorepo-list to see available sources.`,
						"error",
					);
					return;
				}

				// Find package in that source
				const pkg = source.packages.find((p) => p.name === packageName);
				if (!pkg) {
					const available = source.packages.map((p) => `  • ${p.name}`).join("\n");
					ctx.ui.notify(
						`Package "${packageName}" not found in source "${sourceUrl}".\nAvailable packages:\n${available || "  (none)"}`,
						"error",
					);
					return;
				}

				// Ensure node_modules in the monorepo root
				try {
					ensureNodeModules(source.rootPath);
				} catch (err) {
					ctx.ui.notify(
						`Failed to install dependencies for ${source.url}: ${err instanceof Error ? err.message : String(err)}`,
						"error",
					);
					return;
				}

				// Create activation symlink
				try {
					const info = await createActivationSymlink(pkg.path, pkg.name, scope, ctx.cwd);
					pi.appendEntry(ENTRY_TYPES.PACKAGE_INSTALLED, {
						packageName: info.packageName,
						scope: info.scope,
						symlinkPath: info.symlinkPath,
						targetPath: info.targetPath,
						timestamp: info.activatedAt,
					});
					ctx.ui.notify(`Installed ${info.packageName} (${scope} scope). Run /reload to activate.`, "info");
				} catch (err) {
					ctx.ui.notify(
						`Failed to activate ${packageName}: ${err instanceof Error ? err.message : String(err)}`,
						"error",
					);
				}
			} else {
				// No source prefix — search all sources for the package
				packageName = cleanedArgs;

				let found = false;
				for (const source of sources) {
					const pkg = source.packages.find((p) => p.name === packageName);
					if (!pkg) continue;
					found = true;

					// Ensure node_modules
					try {
						ensureNodeModules(source.rootPath);
					} catch (err) {
						ctx.ui.notify(
							`Failed to install dependencies for ${source.url}: ${err instanceof Error ? err.message : String(err)}`,
							"error",
						);
						return;
					}

					// Create activation symlink
					try {
						const info = await createActivationSymlink(pkg.path, pkg.name, scope, ctx.cwd);
						pi.appendEntry(ENTRY_TYPES.PACKAGE_INSTALLED, {
							packageName: info.packageName,
							scope: info.scope,
							symlinkPath: info.symlinkPath,
							targetPath: info.targetPath,
							timestamp: info.activatedAt,
						});
						ctx.ui.notify(`Installed ${info.packageName} (${scope} scope). Run /reload to activate.`, "info");
					} catch (err) {
						ctx.ui.notify(
							`Failed to activate ${packageName}: ${err instanceof Error ? err.message : String(err)}`,
							"error",
						);
					}
					break; // Use first match
				}

				if (!found) {
					const allPkgs = registry.getAllPackages();
					const available = allPkgs.map((p) => `  • ${p.name} (from ${p.sourceUrl})`).join("\n");
					ctx.ui.notify(
						`Package "${packageName}" not found in any source.\nAvailable packages:\n${available || "  (none)"}`,
						"error",
					);
				}
			}
		},
	});

	// --- /monorepo-remove: remove an installed package ---
	pi.registerCommand("monorepo-remove", {
		description: "Remove an installed package (usage: /monorepo-remove <package> [-l])",
		handler: async (args, ctx) => {
			const rawArgs = args.trim();
			if (!rawArgs) {
				ctx.ui.notify("Usage: /monorepo-remove <package> [-l]", "error");
				return;
			}

			// Parse optional -l flag for local scope
			const localFlag = rawArgs.includes("-l");
			const scope: Scope = localFlag ? "local" : "global";
			const packageName = rawArgs.replace(/\s*-l\s*/, "").trim();

			if (!packageName) {
				ctx.ui.notify("Usage: /monorepo-remove <package> [-l]", "error");
				return;
			}

			try {
				const removed = await removeActivationSymlink(packageName, scope, ctx.cwd);
				if (removed) {
					pi.appendEntry(ENTRY_TYPES.PACKAGE_REMOVED, {
						packageName,
						scope,
						timestamp: new Date().toISOString(),
					});
					ctx.ui.notify(`Removed ${packageName} (${scope} scope). Run /reload to deactivate.`, "info");
				} else {
					ctx.ui.notify(`Package ${packageName} was not installed in ${scope} scope.`, "info");
				}
			} catch (err) {
				ctx.ui.notify(`Failed to remove ${packageName}: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	// --- /monorepo-registry: manage registry sources (add/remove/update) ---
	pi.registerCommand("monorepo-registry", {
		description:
			"Manage monorepo registry sources (usage: /monorepo-registry add <url> [packages-root] | remove <url> | update [url])",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];

			if (!subcommand) {
				ctx.ui.notify("Usage: /monorepo-registry add <url> [packages-root] | remove <url> | update [url]", "error");
				return;
			}

			if (subcommand === "add") {
				const url = parts[1];
				if (!url) {
					ctx.ui.notify(
						"Error: URL required. Usage: /monorepo-registry add <url> [packages-root] [monorepo-root]",
						"error",
					);
					return;
				}
				const packagesRoot = parts[2] ?? "packages";
				const monorepoRoot = parts[3]; // optional filesystem path override

				try {
					const source = await registry.addSource(url, packagesRoot, monorepoRoot);
					const pkgCount = source.packages.length;
					ctx.ui.notify(
						`Registry source added: ${url}\nDiscovered ${pkgCount} package${pkgCount !== 1 ? "s" : ""}.`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(`Error adding source: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
			} else if (subcommand === "remove") {
				const url = parts[1];
				if (!url) {
					ctx.ui.notify("Error: URL required. Usage: /monorepo-registry remove <url>", "error");
					return;
				}

				try {
					registry.removeSource(url);
					ctx.ui.notify(`Registry source removed: ${url}`, "info");
				} catch (err) {
					ctx.ui.notify(`Error removing source: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
			} else if (subcommand === "update") {
				const url = parts[1]; // optional — update all if omitted

				try {
					const updated = await registry.updateSource(url);
					if (updated.length === 0) {
						ctx.ui.notify("No sources to update.", "info");
						return;
					}
					for (const source of updated) {
						const pkgCount = source.packages.length;
						ctx.ui.notify(`Updated ${source.url}: ${pkgCount} package${pkgCount !== 1 ? "s" : ""} discovered.`, "info");
					}
				} catch (err) {
					ctx.ui.notify(`Error updating source: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
			} else {
				ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use add, remove, or update.`, "error");
			}
		},
	});

	// --- session_start: announce extension loaded ---
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("pi-monorepo-registry extension loaded ✅", "info");
	});
}
