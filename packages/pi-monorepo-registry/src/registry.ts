/**
 * MonorepoRegistry — manages registered monorepo sources and their discovered packages.
 *
 * The registry is stateless between calls — it reconstructs from the last known state
 * passed to it, making it easy to test and reason about. State mutations are returned
 * as event data so the caller (index.ts) can record them via pi.appendEntry().
 */

import { discoverPackages } from "./discovery.js";
import { extractShortName, resolveSourceRoot } from "./git.js";
import type { MonorepoSource, PackageInfo, RegistryState } from "./types.js";

/** Entry types for registry state transitions. */
export const ENTRY_TYPES = {
	SOURCE_ADDED: "monorepo-source-added",
	SOURCE_REMOVED: "monorepo-source-removed",
	PACKAGES_DISCOVERED: "monorepo-packages-discovered",
} as const;

/** Event data returned by registry mutations for the caller to record. */
export interface RegistryEvent {
	type: string;
	data: Record<string, unknown>;
}

/**
 * Manages monorepo source registrations and package discovery.
 *
 * Usage:
 *   const registry = new MonorepoRegistry(state);
 *   const { source, events } = await registry.addSource("https://github.com/example/monorepo", "packages");
 */
export class MonorepoRegistry {
	private readonly state: RegistryState;

	constructor(state: RegistryState) {
		this.state = state;
	}

	/** Get current registry state (immutable snapshot). */
	getState(): Readonly<RegistryState> {
		return this.state;
	}

	/** Get all registered sources. */
	getSources(): ReadonlyArray<MonorepoSource> {
		return this.state.sources;
	}

	/** Find a source by URL. */
	findSource(url: string): MonorepoSource | undefined {
		return this.state.sources.find((s) => s.url === url);
	}

	/** Find a source by short name (case-insensitive). E.g. "zaephor/pi-extensions". */
	findByShortName(shortName: string): MonorepoSource | undefined {
		const lower = shortName.toLowerCase();
		return this.state.sources.find((s) => s.shortName === lower);
	}

	/** Find all sources that contain a package with the given name. */
	findPackageSources(packageName: string): Array<MonorepoSource> {
		return this.state.sources.filter((s) => s.packages.some((p) => p.name === packageName));
	}

	/**
	 * Register a new monorepo source and discover its packages.
	 *
	 * @param url - Git URL or local path of the monorepo.
	 * @param packagesRoot - Subdirectory containing packages (default: "packages").
	 * @param monorepoRoot - Override for the actual filesystem path (useful for local/cloned repos).
	 *   Defaults to `url` (assumes url is a local path).
	 * @returns The newly created MonorepoSource and events for the caller to record.
	 * @throws Error if the source is already registered.
	 */
	async addSource(
		url: string,
		packagesRoot = "packages",
		monorepoRoot?: string,
	): Promise<{ source: MonorepoSource; events: RegistryEvent[] }> {
		if (this.findSource(url)) {
			throw new Error(`Source already registered: ${url}`);
		}

		// Resolve git URLs to local filesystem paths (clone or detect self)
		const resolved = monorepoRoot ? { rootPath: monorepoRoot, cloned: false } : resolveSourceRoot(url);
		const root = resolved.rootPath;
		let packages: PackageInfo[];
		try {
			packages = await discoverPackages(root, packagesRoot);
		} catch (err) {
			throw new Error(`Failed to discover packages in ${root}: ${err instanceof Error ? err.message : String(err)}`);
		}

		const source: MonorepoSource = {
			url,
			shortName: extractShortName(url),
			packagesRoot,
			packages,
			lastUpdated: new Date().toISOString(),
			rootPath: root,
		};

		this.state.sources.push(source);

		const events: RegistryEvent[] = [];

		events.push({
			type: ENTRY_TYPES.SOURCE_ADDED,
			data: {
				source: url,
				packagesRoot,
				packageCount: packages.length,
				timestamp: source.lastUpdated,
			},
		});

		if (packages.length > 0) {
			events.push({
				type: ENTRY_TYPES.PACKAGES_DISCOVERED,
				data: {
					source: url,
					packages: packages.map((p) => p.name),
					timestamp: source.lastUpdated,
				},
			});
		}

		return { source, events };
	}

	/**
	 * Remove a registered monorepo source.
	 *
	 * @param url - URL of the source to remove.
	 * @returns Event data for the caller to record.
	 * @throws Error if the source is not found.
	 */
	removeSource(url: string): RegistryEvent {
		const index = this.state.sources.findIndex((s) => s.url === url);
		if (index === -1) {
			throw new Error(`Source not found: ${url}`);
		}

		this.state.sources.splice(index, 1);

		return {
			type: ENTRY_TYPES.SOURCE_REMOVED,
			data: {
				source: url,
				timestamp: new Date().toISOString(),
			},
		};
	}

	/**
	 * Re-discover packages for a specific source (or all sources).
	 *
	 * @param identifier - URL or shortName of the source to update, or undefined to update all.
	 * @param monorepoRoot - Override for the filesystem path.
	 * @returns Updated source(s) and events for the caller to record.
	 */
	async updateSource(
		identifier?: string,
		monorepoRoot?: string,
	): Promise<{ updated: MonorepoSource[]; events: RegistryEvent[] }> {
		let sources: MonorepoSource[];
		if (identifier) {
			const found = this.findSource(identifier) ?? this.findByShortName(identifier);
			if (!found) {
				throw new Error(`Source not found: ${identifier}`);
			}
			sources = [found];
		} else {
			sources = [...this.state.sources];
		}

		const updated: MonorepoSource[] = [];
		const events: RegistryEvent[] = [];

		for (const source of sources) {
			const resolved = monorepoRoot ? { rootPath: monorepoRoot, cloned: false } : resolveSourceRoot(source.url);
			const root = resolved.rootPath;
			let packages: PackageInfo[];
			try {
				packages = await discoverPackages(root, source.packagesRoot);
			} catch (err) {
				throw new Error(
					`Failed to discover packages in ${root}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			source.packages = packages;
			source.lastUpdated = new Date().toISOString();
			source.rootPath = root;
			updated.push(source);

			events.push({
				type: ENTRY_TYPES.PACKAGES_DISCOVERED,
				data: {
					source: source.url,
					packages: packages.map((p) => p.name),
					timestamp: source.lastUpdated,
				},
			});
		}

		return { updated, events };
	}

	/**
	 * Get all discovered packages across all sources.
	 */
	getAllPackages(): Array<PackageInfo & { sourceUrl: string }> {
		const result: Array<PackageInfo & { sourceUrl: string }> = [];
		for (const source of this.state.sources) {
			for (const pkg of source.packages) {
				result.push({ ...pkg, sourceUrl: source.url });
			}
		}
		return result;
	}
}
