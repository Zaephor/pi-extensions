/**
 * pi-monorepo-registry — Discover and manage packages across monorepo sources.
 *
 * Registers ONLY the /monorego-registry command for source CRUD operations.
 * Package install/remove/list commands come in S02.
 * State is persisted to disk via persistence.ts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getStateFilePath } from "./paths.js";
import { loadState, saveState } from "./persistence.js";
import { MonorepoRegistry } from "./registry.js";

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
export { getExtensionsDir, getGitDir, getMonorepoDir, getRegistryBaseDir, getStateFilePath } from "./paths.js";
export { MonorepoRegistry } from "./registry.js";
export type { InstalledPackage, MonorepoSource, PackageInfo, RegistryState } from "./types.js";

/** Helper to persist state after mutations. */
function persist(registry: MonorepoRegistry): Promise<void> {
	return saveState(registry.getState());
}

export default async function (pi: ExtensionAPI) {
	// Load persisted state from disk
	const savedState = await loadState();
	const stateFilePath = getStateFilePath();
	const registry = new MonorepoRegistry(savedState);

	// --- /monorego-registry: manage registry sources (add/remove/list/update) ---
	pi.registerCommand("monorego-registry", {
		description:
			"Manage monorepo registry sources (add/remove/list/update [source])",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0];

			if (!subcommand) {
				ctx.ui.notify(
					"Usage: /monorego-registry add <url> [packages-root] | remove <source> | list | update [source]",
					"error",
				);
				return;
			}

			if (subcommand === "add") {
				const url = parts[1];
				if (!url) {
					ctx.ui.notify("Error: URL required. Usage: /monorego-registry add <url> [packages-root]", "error");
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
			} else if (subcommand === "remove") {
				const identifier = parts[1];
				if (!identifier) {
					ctx.ui.notify("Error: source required. Usage: /monorego-registry remove <url-or-shortname>", "error");
					return;
				}

				// Match by URL or shortName (case-insensitive)
				let source = registry.findSource(identifier);
				if (!source) {
					source = registry.findByShortName(identifier);
				}

				if (!source) {
					ctx.ui.notify(
						`Source "${identifier}" not found. Use /monorego-registry list to see registered sources.`,
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
			} else if (subcommand === "update") {
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
			} else if (subcommand === "list") {
				const sources = registry.getSources();

				if (sources.length === 0) {
					ctx.ui.notify(
						`No monorepo sources registered.\nState: ${stateFilePath}\n\nUse /monorego-registry add <url> to add a source.`,
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
			} else {
				ctx.ui.notify(`Unknown subcommand: ${subcommand}. Use add, remove, list, or update.`, "error");
			}
		},
	});

	// --- session_start: display source count ---
	pi.on("session_start", async (_event, ctx) => {
		const sourceCount = registry.getSources().length;
		ctx.ui.notify(
			`[Registry] ${sourceCount} source${sourceCount !== 1 ? "s" : ""} | state: ${stateFilePath}`,
			"info",
		);
	});
}
