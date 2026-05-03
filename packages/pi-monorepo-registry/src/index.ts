/**
 * pi-monorepo-registry — Discover and manage packages across monorepo sources.
 *
 * Provides slash commands for listing discovered packages, installing packages
 * from registered monorepos, removing packages, and managing registry sources.
 * Registry state is persisted to disk so it survives pi restarts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createActivationSymlink, removeActivationSymlink } from "./activation.js";
import { ensureNodeModules } from "./deps.js";
import { getStateFilePath, loadState, saveState } from "./persistence.js";
import { ENTRY_TYPES, MonorepoRegistry } from "./registry.js";
import type { MonorepoSource, Scope } from "./types.js";

export { discoverPackages, isPiCompatible } from "./discovery.js";
export {
	extractShortName,
	getExtensionMonorepoRoot,
	isGitUrl,
	isSelfUrl,
	normalizeGitUrl,
	resolveSourceRoot,
	urlToDirName,
} from "./git.js";
export { MonorepoRegistry } from "./registry.js";
export type { MonorepoSource, PackageInfo, RegistryState } from "./types.js";

/** Helper to persist state after mutations. */
function persist(registry: MonorepoRegistry): Promise<void> {
	return saveState(registry.getState());
}

export default async function (pi: ExtensionAPI) {
	// Load persisted state from disk
	const savedState = await loadState();
	const _stateFilePath = getStateFilePath();
	const registry = new MonorepoRegistry(pi, savedState);

	// --- Load sub-extensions from the registry's managed active/ directory ---
	// This runs in the factory (not session_start) so it fires on both startup and /reload.
	const { getExtensionsDir } = await import("./activation.js");
	const { discoverActiveExtensions, loadActiveExtensions } = await import("./loader.js");

	const activeDir = getExtensionsDir("global");
	const { loaded, errors } = await loadActiveExtensions(activeDir, pi);

	// Store results for session_start display
	const _loadedExtensions = loaded;
	const _loadErrors = errors;
	const _activeDir = activeDir;

	// --- /monorepo-list: show sources, available packages, and installed packages ---
	pi.registerCommand("monorepo-list", {
		description: "List registered sources, available packages, and installed packages",
		handler: async (_args, ctx) => {
			const sources = registry.getSources();
			const globalActiveDir = getExtensionsDir("global", ctx.cwd);
			const localActiveDir = getExtensionsDir("local", ctx.cwd);
			const globalInstalled = discoverActiveExtensions(globalActiveDir);
			const localInstalled = discoverActiveExtensions(localActiveDir);

			if (sources.length === 0 && globalInstalled.length === 0 && localInstalled.length === 0) {
				ctx.ui.notify(
					`No monorepo sources registered and no packages installed.\nState: ${_stateFilePath}\nGlobal active dir: ${globalActiveDir}\nLocal active dir: ${localActiveDir}\n\nUse /monorepo-registry add <url> to add a source.`,
					"info",
				);
				return;
			}

			// --- Sources & available packages ---
			if (sources.length > 0) {
				const pkgCounts = new Map<string, string[]>();
				for (const source of sources) {
					for (const pkg of source.packages) {
						const owners = pkgCounts.get(pkg.name) ?? [];
						owners.push(source.shortName);
						pkgCounts.set(pkg.name, owners);
					}
				}

				const lines: string[] = ["Sources:", ""];

				for (const source of sources) {
					lines.push(`📦 ${source.shortName}`);
					lines.push(`   url: ${source.url}`);
					lines.push(`   packages-root: ${source.packagesRoot}`);
					lines.push(`   last updated: ${source.lastUpdated}`);

					if (source.packages.length === 0) {
						lines.push("   (no packages discovered)");
					} else {
						for (const pkg of source.packages) {
							const desc = pkg.description ? ` — ${pkg.description}` : "";
							const dup = (pkgCounts.get(pkg.name)?.length ?? 0) > 1 ? " ⚠️ duplicate" : "";
							lines.push(`   • ${pkg.name}@${pkg.version}${desc}${dup}`);
						}
					}

					lines.push("");
				}

				ctx.ui.notify(lines.join("\n"), "info");
			} else {
				ctx.ui.notify("No sources registered.", "info");
			}

			// --- Installed packages ---
			if (globalInstalled.length > 0 || localInstalled.length > 0) {
				const lines: string[] = [`Installed (${globalActiveDir}):`, ""];

				if (globalInstalled.length > 0) {
					lines.push("  global:");
					for (const ext of globalInstalled) {
						lines.push(`    • ${ext.name}`);
					}
				}

				if (localInstalled.length > 0) {
					if (globalInstalled.length > 0) lines.push("");
					lines.push("  local:");
					for (const ext of localInstalled) {
						lines.push(`    • ${ext.name}`);
					}
				}

				ctx.ui.notify(lines.join("\n"), "info");
			} else {
				ctx.ui.notify(
					`No packages installed.\nGlobal active dir: ${globalActiveDir}\nUse /monorepo-install <package> to install one.`,
					"info",
				);
			}
		},
	});

	// --- /monorepo-install: install a package from a registered monorepo ---
	pi.registerCommand("monorepo-install", {
		description: "Install a package from a registered monorepo (usage: /monorepo-install <source>/<package> [-l])",
		handler: async (args, ctx) => {
			const rawArgs = args.trim();
			if (!rawArgs) {
				ctx.ui.notify(
					"Usage: /monorepo-install <package> [-l]  or  /monorepo-install <owner/repo>/<package> [-l]",
					"error",
				);
				return;
			}

			// Parse optional -l flag for local scope
			const localFlag = rawArgs.includes("-l");
			const scope: Scope = localFlag ? "local" : "global";
			const cleanedArgs = rawArgs.replace(/\s*-l\s*/, "").trim();

			if (!cleanedArgs) {
				ctx.ui.notify(
					"Usage: /monorepo-install <package> [-l]  or  /monorepo-install <owner/repo>/<package> [-l]",
					"error",
				);
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

			// Try to match "owner/repo/package-name" format (source shortName as prefix)
			let packageName: string;
			let targetSource: MonorepoSource | undefined;

			for (const source of sources) {
				const prefix = `${source.shortName}/`;
				if (cleanedArgs.toLowerCase().startsWith(prefix)) {
					const remainder = cleanedArgs.slice(prefix.length);
					const pkgMatch = source.packages.find((p) => p.name === remainder);
					if (pkgMatch) {
						targetSource = source;
						packageName = remainder;
						break;
					}
				}
			}

			if (targetSource && packageName!) {
				// Source-qualified install — explicit source specified
				const pkg = targetSource.packages.find((p) => p.name === packageName)!;

				try {
					ensureNodeModules(targetSource.rootPath);
				} catch (err) {
					ctx.ui.notify(
						`Failed to install dependencies for ${targetSource.shortName}: ${err instanceof Error ? err.message : String(err)}`,
						"error",
					);
					return;
				}

				try {
					const info = await createActivationSymlink(pkg.path, pkg.name, scope, ctx.cwd);
					pi.appendEntry(ENTRY_TYPES.PACKAGE_INSTALLED, {
						packageName: info.packageName,
						scope: info.scope,
						symlinkPath: info.symlinkPath,
						targetPath: info.targetPath,
						timestamp: info.activatedAt,
					});
					ctx.ui.notify(
						`Installed ${info.packageName} from ${targetSource.shortName} (${scope} scope). Run /reload to activate.`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(
						`Failed to activate ${packageName}: ${err instanceof Error ? err.message : String(err)}`,
						"error",
					);
				}
			} else {
				// Bare package name — no source prefix
				packageName = cleanedArgs;

				const matchingSources = registry.findPackageSources(packageName);

				if (matchingSources.length === 0) {
					const allPkgs = registry.getAllPackages();
					const available = allPkgs.map((p) => `  • ${p.name} (${p.sourceUrl})`).join("\n");
					ctx.ui.notify(
						`Package "${packageName}" not found in any source.\nAvailable packages:\n${available || "  (none)"}`,
						"error",
					);
					return;
				}

				if (matchingSources.length > 1) {
					// Ambiguous — block and force disambiguation
					const options = matchingSources.map((s) => `  /monorepo-install ${s.shortName}/${packageName}`).join("\n");
					ctx.ui.notify(`Package "${packageName}" exists in multiple sources. Please specify:\n${options}`, "error");
					return;
				}

				// Exactly one source has this package
				const source = matchingSources[0];
				const pkg = source.packages.find((p) => p.name === packageName)!;

				try {
					ensureNodeModules(source.rootPath);
				} catch (err) {
					ctx.ui.notify(
						`Failed to install dependencies for ${source.shortName}: ${err instanceof Error ? err.message : String(err)}`,
						"error",
					);
					return;
				}

				try {
					const info = await createActivationSymlink(pkg.path, pkg.name, scope, ctx.cwd);
					pi.appendEntry(ENTRY_TYPES.PACKAGE_INSTALLED, {
						packageName: info.packageName,
						scope: info.scope,
						symlinkPath: info.symlinkPath,
						targetPath: info.targetPath,
						timestamp: info.activatedAt,
					});
					ctx.ui.notify(
						`Installed ${info.packageName} from ${source.shortName} (${scope} scope). Run /reload to activate.`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(
						`Failed to activate ${packageName}: ${err instanceof Error ? err.message : String(err)}`,
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
			"Manage monorepo registry sources (usage: /monorepo-registry add <url> [packages-root] | remove <url-or-shortname> | update [url-or-shortname])",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];

			if (!subcommand) {
				ctx.ui.notify(
					"Usage: /monorepo-registry add <url> [packages-root] | remove <source> | update [source]",
					"error",
				);
				return;
			}

			if (subcommand === "add") {
				const url = parts[1];
				if (!url) {
					ctx.ui.notify("Error: URL required. Usage: /monorepo-registry add <url> [packages-root]", "error");
					return;
				}
				const packagesRoot = parts[2] ?? "packages";

				try {
					const source = await registry.addSource(url, packagesRoot);
					await persist(registry);
					const pkgCount = source.packages.length;
					ctx.ui.notify(
						`Registry source added: ${source.shortName}\nDiscovered ${pkgCount} package${pkgCount !== 1 ? "s" : ""}.`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(`Error adding source: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
			} else if (subcommand === "remove") {
				const identifier = parts[1];
				if (!identifier) {
					ctx.ui.notify("Error: source required. Usage: /monorepo-registry remove <url-or-shortname>", "error");
					return;
				}

				// Match by URL or shortName (case-insensitive)
				let source = registry.findSource(identifier);
				if (!source) {
					source = registry.findByShortName(identifier);
				}

				if (!source) {
					ctx.ui.notify(`Source "${identifier}" not found. Use /monorepo-list to see registered sources.`, "error");
					return;
				}

				try {
					registry.removeSource(source.url);
					await persist(registry);
					ctx.ui.notify(`Registry source removed: ${source.shortName}`, "info");
				} catch (err) {
					ctx.ui.notify(`Error removing source: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
			} else if (subcommand === "update") {
				const identifier = parts[1]; // optional — update all if omitted

				try {
					const updated = await registry.updateSource(identifier);
					await persist(registry);
					if (updated.length === 0) {
						ctx.ui.notify("No sources to update.", "info");
						return;
					}
					for (const source of updated) {
						const pkgCount = source.packages.length;
						ctx.ui.notify(
							`Updated ${source.shortName}: ${pkgCount} package${pkgCount !== 1 ? "s" : ""} discovered.`,
							"info",
						);
					}
				} catch (err) {
					ctx.ui.notify(`Error updating source: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
			} else {
				ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use add, remove, or update.`, "error");
			}
		},
	});

	// --- session_start: display loaded sub-extensions alongside pi's startup ---
	pi.on("session_start", async (_event, ctx) => {
		const sourceCount = registry.getSources().length;

		const lines = ["[Registry Extensions]"];
		for (const name of _loadedExtensions) {
			lines.push(`  ${name}`);
		}
		if (_loadedExtensions.length === 0) {
			lines.push("  (none loaded)");
		}
		for (const err of _loadErrors) {
			lines.push(`  ⚠ ${err.name}: ${err.error}`);
		}
		lines.push(
			`${sourceCount} source${sourceCount !== 1 ? "s" : ""} | state: ${_stateFilePath} | loaded: ${_loadedExtensions.length}${_loadErrors.length > 0 ? ` | errors: ${_loadErrors.map((e) => `${e.name}: ${e.error}`).join(", ")}` : ""}`,
		);

		ctx.ui.notify(lines.join("\n"), _loadErrors.length > 0 ? "warning" : "info");
	});
}
