/**
 * pi-monorepo-registry — Discover and manage packages across monorepo sources.
 *
 * Registers two commands:
 *   /monorepo-registry  — manage registry sources (add/remove/list/update)
 *   /monorepo-package   — install/remove/update/list packages
 *
 * State is persisted to disk via persistence.ts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PackageManager, packageNameToDirName } from "./packages.js";
import { getExtensionsDir, getGitDir, getSettingsFilePath, getStateFilePath } from "./paths.js";
import { loadState, saveState } from "./persistence.js";
import { MonorepoRegistry } from "./registry.js";
import type { ActivationMode } from "./types.js";

// Re-export public API for downstream consumers
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
export { PackageManager, packageNameToDirName } from "./packages.js";
export { getExtensionsDir, getGitDir, getMonorepoDir, getRegistryBaseDir, getStateFilePath } from "./paths.js";
export { MonorepoRegistry } from "./registry.js";
export type { ActivationMode, InstalledPackage, MonorepoSource, PackageInfo, RegistryState } from "./types.js";

/** Helper to persist state after mutations. */
function persist(registry: MonorepoRegistry): Promise<void> {
	return saveState(registry.getState());
}

export default async function (pi: ExtensionAPI) {
	// Load persisted state from disk
	const savedState = await loadState();
	const stateFilePath = getStateFilePath();
	const registry = new MonorepoRegistry(savedState);

	// --- /monorepo-registry: manage registry sources (add/remove/list/update) ---
	pi.registerCommand("monorepo-registry", {
		description: "Manage monorepo registry sources (add/remove/list/update [source])",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];

			if (!subcommand) {
				ctx.ui.notify(
					"Usage: /monorepo-registry add <url> [packages-root] | remove <source> | list | update [source]",
					"error",
				);
				return;
			}

			switch (subcommand) {
				case "add": {
					const url = parts[1];
					if (!url) {
						ctx.ui.notify("Error: URL required. Usage: /monorepo-registry add <url> [packages-root]", "error");
						return;
					}
					const packagesRoot = parts[2] ?? "packages";

					try {
						const { source, events } = await registry.addSource(url, packagesRoot);

						// Record events via pi.appendEntry
						for (const event of events) {
							pi.appendEntry(event.type, event.data);
						}

						await persist(registry);
						const pkgCount = source.packages.length;
						ctx.ui.notify(
							`Registry source added: ${source.shortName}\nDiscovered ${pkgCount} package${pkgCount !== 1 ? "s" : ""}.`,
							"info",
						);
					} catch (err) {
						ctx.ui.notify(`Error adding source: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
					return;
				}
				case "remove": {
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
						ctx.ui.notify(
							`Source "${identifier}" not found. Use /monorepo-registry list to see registered sources.`,
							"error",
						);
						return;
					}

					try {
						const event = registry.removeSource(source.url);
						pi.appendEntry(event.type, event.data);
						await persist(registry);
						ctx.ui.notify(`Registry source removed: ${source.shortName}`, "info");
					} catch (err) {
						ctx.ui.notify(`Error removing source: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
					return;
				}
				case "update": {
					const identifier = parts[1]; // optional — update all if omitted

					try {
						const { updated, events } = await registry.updateSource(identifier);

						// Record events via pi.appendEntry
						for (const event of events) {
							pi.appendEntry(event.type, event.data);
						}

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
					return;
				}
				case "list": {
					const sources = registry.getSources();

					if (sources.length === 0) {
						ctx.ui.notify(
							`No monorepo sources registered.\nState: ${stateFilePath}\n\nUse /monorepo-registry add <url> to add a source.`,
							"info",
						);
						return;
					}

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
					return;
				}
				default:
					ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use add, remove, list, or update.`, "error");
					return;
			}
		},
	});

	// --- /monorepo-package: install/remove/update/list packages ---
	const pkgManager = new PackageManager(savedState);

	pi.registerCommand("monorepo-package", {
		description: "Install, remove, update, or list packages from monorepo sources",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];

			if (!subcommand) {
				ctx.ui.notify(
					"Usage: /monorepo-package install <name> [--dev <path>] [--git] [--source <url>] [--version <semver>]\n" +
						"       /monorepo-package remove <name>\n" +
						"       /monorepo-package update <name> [--version <semver>]\n" +
						"       /monorepo-package list",
					"error",
				);
				return;
			}

			const extensionsDir = getExtensionsDir();
			const settingsFilePath = getSettingsFilePath();
			const gitDir = getGitDir();

			switch (subcommand) {
				case "install": {
					const pkgName = parts[1];
					if (!pkgName) {
						ctx.ui.notify(
							"Error: package name required. Usage: /monorepo-package install <name> [--dev <path>] [--git] [--source <url>] [--version <semver>]",
							"error",
						);
						return;
					}

					// Parse flags
					let devPath: string | undefined;
					let useGit = false;
					let sourceId: string | undefined;
					let version: string | undefined;

					for (let i = 2; i < parts.length; i++) {
						if (parts[i] === "--dev" && parts[i + 1]) {
							devPath = parts[++i];
						} else if (parts[i] === "--git") {
							useGit = true;
						} else if (parts[i] === "--source" && parts[i + 1]) {
							sourceId = parts[++i];
						} else if (parts[i] === "--version" && parts[i + 1]) {
							version = parts[++i];
						}
					}

					try {
						if (devPath) {
							// --dev mode: symlink to local checkout
							const sourceUrl = sourceId ?? devPath;
							const events = await pkgManager.installDev(pkgName, sourceUrl, {
								localPath: devPath,
								settingsFilePath,
								extensionsDir,
								gitDir,
							});
							for (const event of events) {
								pi.appendEntry(event.type, event.data);
							}
							await persist(registry);
							ctx.ui.notify(`Package "${pkgName}" installed (dev → ${devPath}).\nRun /reload to activate.`, "info");
						} else if (useGit) {
							// --git mode: clone + symlink
							const source = resolveSourceForPackage(registry, pkgName, sourceId);
							if (!source) {
								ctx.ui.notify(
									`No source found for package "${pkgName}". Register a source first with /monorepo-registry add, or specify --source.`,
									"error",
								);
								return;
							}
							const events = await pkgManager.installGit(pkgName, source.url, {
								sourceUrl: source.url,
								packagesRoot: source.packagesRoot,
								settingsFilePath,
								extensionsDir,
								gitDir,
							});
							for (const event of events) {
								pi.appendEntry(event.type, event.data);
							}
							await persist(registry);
							ctx.ui.notify(
								`Package "${pkgName}" installed (git → ${source.shortName}).\nRun /reload to activate.`,
								"info",
							);
						} else {
							// Default: tarball mode
							const source = resolveSourceForPackage(registry, pkgName, sourceId);
							if (!source) {
								ctx.ui.notify(
									`No source found for package "${pkgName}". Register a source first with /monorepo-registry add, or specify --source.`,
									"error",
								);
								return;
							}
							const pkgVersion = version ?? resolvePackageVersion(source, pkgName);
							if (!pkgVersion) {
								ctx.ui.notify(`Cannot determine version for "${pkgName}". Specify --version <semver>.`, "error");
								return;
							}

							// Build monorepo-relative package path (e.g. "packages/pi-template")
							const pkgDir = packageNameToDirName(pkgName);
							const packagePath = `${source.packagesRoot}/${pkgDir}`;

							const events = await pkgManager.installTarball(pkgName, source.url, {
								sourceUrl: source.url,
								version: pkgVersion,
								packagePath,
								settingsFilePath,
								extensionsDir,
								gitDir,
							});
							for (const event of events) {
								pi.appendEntry(event.type, event.data);
							}
							await persist(registry);
							ctx.ui.notify(
								`Package "${pkgName}@${pkgVersion}" installed (tarball).\nRun /reload to activate.`,
								"info",
							);
						}
					} catch (err) {
						ctx.ui.notify(`Error installing package: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
					return;
				}
				case "remove": {
					const pkgName = parts[1];
					if (!pkgName) {
						ctx.ui.notify("Error: package name required. Usage: /monorepo-package remove <name>", "error");
						return;
					}

					try {
						const events = await pkgManager.remove(pkgName, {
							settingsFilePath,
							extensionsDir,
						});
						for (const event of events) {
							pi.appendEntry(event.type, event.data);
						}
						await persist(registry);
						ctx.ui.notify(`Package "${pkgName}" removed.\nRun /reload to complete cleanup.`, "info");
					} catch (err) {
						ctx.ui.notify(`Error removing package: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
					return;
				}
				case "update": {
					const pkgName = parts[1];
					if (!pkgName) {
						ctx.ui.notify(
							"Error: package name required. Usage: /monorepo-package update <name> [--version <semver>]",
							"error",
						);
						return;
					}

					// Parse flags
					let version: string | undefined;
					for (let i = 2; i < parts.length; i++) {
						if (parts[i] === "--version" && parts[i + 1]) {
							version = parts[++i];
						}
					}

					try {
						const installed = pkgManager.findInstalled(pkgName);
						if (!installed) {
							ctx.ui.notify(`Package "${pkgName}" is not installed.`, "error");
							return;
						}
						if (installed.activationMode !== "tarball") {
							ctx.ui.notify(
								`Cannot update "${pkgName}": update is only supported for tarball-activated packages (current mode: ${installed.activationMode}). For dev/git packages, update the source directly.`,
								"error",
							);
							return;
						}

						// Resolve source and version
						const source = registry.findSource(installed.sourceUrl) ?? registry.findByShortName(installed.sourceUrl);
						if (!source) {
							ctx.ui.notify(
								`Source "${installed.sourceUrl}" not found in registry. Cannot resolve update URL. Re-add the source first.`,
								"error",
							);
							return;
						}

						const pkgVersion = version ?? resolvePackageVersion(source, pkgName);
						if (!pkgVersion) {
							ctx.ui.notify(`Cannot determine version for "${pkgName}". Specify --version <semver>.`, "error");
							return;
						}

						const pkgDir = packageNameToDirName(pkgName);
						const packagePath = `${source.packagesRoot}/${pkgDir}`;

						const events = await pkgManager.update(pkgName, {
							sourceUrl: source.url,
							version: pkgVersion,
							packagePath,
							settingsFilePath,
							extensionsDir,
						});
						for (const event of events) {
							pi.appendEntry(event.type, event.data);
						}
						await persist(registry);
						ctx.ui.notify(`Package "${pkgName}" updated to ${pkgVersion}.\nRun /reload to activate.`, "info");
					} catch (err) {
						ctx.ui.notify(`Error updating package: ${err instanceof Error ? err.message : String(err)}`, "error");
					}
					return;
				}
				case "list": {
					const installed = pkgManager.listInstalled();

					if (installed.length === 0) {
						ctx.ui.notify(
							`No packages installed.\nState: ${stateFilePath}\n\nUse /monorepo-package install <name> to install a package.`,
							"info",
						);
						return;
					}

					const lines: string[] = ["Installed packages:", ""];

					for (const pkg of installed) {
						const modeLabel = modeToLabel(pkg.activationMode);
						const source = registry.findSource(pkg.sourceUrl) ?? registry.findByShortName(pkg.sourceUrl);
						const sourceLabel = source ? source.shortName : pkg.sourceUrl;
						lines.push(`📦 ${pkg.name}`);
						lines.push(`   mode: ${modeLabel}`);
						lines.push(`   source: ${sourceLabel}`);
						lines.push(`   installed: ${pkg.installedAt}`);
						lines.push(`   target: ${pkg.targetPath}`);
						lines.push("");
					}

					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}
				default:
					ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use install, remove, update, or list.`, "error");
					return;
			}
		},
	});

	// --- session_start: display source count ---
	pi.on("session_start", async (_event, ctx) => {
		const sourceCount = registry.getSources().length;
		const pkgCount = pkgManager.listInstalled().length;
		ctx.ui.notify(
			`[Registry] ${sourceCount} source${sourceCount !== 1 ? "s" : ""}, ${pkgCount} package${pkgCount !== 1 ? "s" : ""} installed | state: ${stateFilePath}`,
			"info",
		);
	});
}

// --------------- Helpers ---------------

/** Human-readable labels for activation modes. */
function modeToLabel(mode: ActivationMode): string {
	switch (mode) {
		case "dev":
			return "dev (symlink)";
		case "git":
			return "git (clone + symlink)";
		case "tarball":
			return "tarball (download)";
	}
}

/**
 * Resolve a source for a package by looking up registered sources.
 * If sourceId is provided, match by URL or shortName.
 * Otherwise, find the first source containing the package.
 */
function resolveSourceForPackage(registry: MonorepoRegistry, pkgName: string, sourceId?: string) {
	if (sourceId) {
		const source = registry.findSource(sourceId) ?? registry.findByShortName(sourceId);
		return source;
	}
	// Find first source containing this package
	const sources = registry.findPackageSources(pkgName);
	return sources.length > 0 ? sources[0] : undefined;
}

/**
 * Resolve the version of a package from its source's discovered packages list.
 * Returns the version from the source's package info, or undefined if not found.
 */
function resolvePackageVersion(
	source: { packages: Array<{ name: string; version: string }> },
	pkgName: string,
): string | undefined {
	const pkg = source.packages.find((p) => p.name === pkgName);
	return pkg?.version;
}
