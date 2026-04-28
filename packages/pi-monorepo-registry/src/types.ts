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

/**
 * State of the monorepo registry, persisted via pi.appendEntry().
 * Represented as a serialisable object for session history entries.
 */
export interface RegistryState {
	sources: MonorepoSource[];
}

/** Scope for package activation — global (user-level) or local (project-level). */
export type Scope = "global" | "local";

/** Information about an activated (symlinked) package. */
export interface ActivationInfo {
	/** Package name (e.g. "pi-template"). */
	packageName: string;
	/** Activation scope — global or local. */
	scope: Scope;
	/** Absolute path to the symlink in the extensions directory. */
	symlinkPath: string;
	/** Absolute path to the real package directory the symlink points to. */
	targetPath: string;
	/** ISO timestamp when the activation occurred. */
	activatedAt: string;
}
