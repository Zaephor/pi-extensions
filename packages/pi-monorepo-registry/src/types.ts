/**
 * Type definitions for pi-monorepo-registry.
 */

/** Information about a discovered package in a monorepo. */
export interface PackageInfo {
	/** Package name from package.json. */
	name: string;
	/** Package description from package.json (may be empty). */
	description: string;
	/** Package version from package.json. */
	version: string;
	/** Absolute path to the package directory. */
	path: string;
	/** Whether this package appears to be a pi extension (has pi.extensions or pi-package keyword). */
	isPiPackage: boolean;
}

/** A registered monorepo source (e.g. a git repository URL). */
export interface MonorepoSource {
	/** The URL or path identifying the monorepo source. */
	url: string;
	/** Short human-friendly reference extracted from the URL (e.g. "owner/repo"). Case-insensitive for matching. */
	shortName: string;
	/** Subdirectory containing packages (default: "packages"). */
	packagesRoot: string;
	/** Packages discovered in this source. */
	packages: PackageInfo[];
	/** ISO timestamp when this source was last updated. */
	lastUpdated: string;
	/**
	 * Actual filesystem path for the monorepo root.
	 * Defaults to `url` but can be overridden when registering with a different root path.
	 */
	rootPath: string;
}

/** How a package was installed / activated. */
export type ActivationMode = "dev" | "git" | "tarball";

/** A package that has been installed into the registry's managed extensions directory. */
export interface InstalledPackage {
	/** Package name (e.g. "pi-template"). */
	name: string;
	/** URL of the source this package was installed from. */
	sourceUrl: string;
	/** How the package was activated. */
	activationMode: ActivationMode;
	/** ISO timestamp when the package was installed. */
	installedAt: string;
	/** Absolute path to the real package directory. */
	targetPath: string;
	/** Relative path inside the extensions directory (e.g. "pi-template" or "@scope/pkg"). */
	extensionDir: string;
}

/**
 * State of the monorepo registry, persisted to state.json under the monorepo directory.
 * Represented as a serialisable object.
 */
export interface RegistryState {
	sources: MonorepoSource[];
	installedPackages: InstalledPackage[];
}
