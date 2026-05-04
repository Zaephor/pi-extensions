/**
 * PackageManager — install, remove, and update packages from monorepo sources.
 *
 * Three activation modes for install:
 *   - dev:     symlink from extensions/<dirName> → local checkout path
 *   - git:     clone/update source repo, then symlink extensions/<dirName> → cloned package dir
 *   - tarball: download GitHub release tarball, extract to extensions/<dirName>
 *
 * Follows the MonorepoRegistry pattern: class takes RegistryState in constructor,
 * methods mutate state in-place and return RegistryEvent[] for the caller to record.
 *
 * All file-path-dependent methods accept explicit paths for testability.
 */

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { renameSync } from "node:fs";
import { resolveSourceRoot, urlToDirName } from "./git.js";
import { getExtensionsDir, getGitDir, getSettingsFilePath } from "./paths.js";
import { registerExtensionPath, unregisterExtensionPath } from "./settings.js";
import { downloadAndExtract, resolveTarballUrl } from "./tarball.js";
import type { ActivationMode, InstalledPackage, RegistryState } from "./types.js";
import type { RegistryEvent } from "./registry.js";

// --------------- Entry types ---------------

export const PACKAGE_ENTRY_TYPES = {
	PACKAGE_INSTALLED: "monorepo-package-installed",
	PACKAGE_REMOVED: "monorepo-package-removed",
	PACKAGE_UPDATED: "monorepo-package-updated",
} as const;

// --------------- Helpers ---------------

/**
 * Encode a package name as a filesystem-safe directory name.
 * Scoped packages: @scope/pkg → @scope-pkg (replace / with -)
 * Regular packages: pi-template → pi-template (unchanged)
 */
export function packageNameToDirName(packageName: string): string {
	return packageName.replace(/\//g, "-");
}

/**
 * Find an installed package by name in the registry state.
 */
function findInstalled(state: RegistryState, packageName: string): InstalledPackage | undefined {
	return state.installedPackages.find((p) => p.name === packageName);
}

/**
 * Create a symlink, replacing any existing file/symlink at the target path.
 * Creates parent directories as needed.
 */
function createSymlink(target: string, linkPath: string): void {
	const dir = dirname(linkPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	// Remove existing file, directory, or symlink at linkPath.
	// Use lstatSync (doesn't follow symlinks) so we detect dangling links too.
	// existsSync follows symlinks and returns false for dangling links.
	try {
		lstatSync(linkPath);
		// Something exists at linkPath — remove it
		rmSync(linkPath, { force: true, recursive: true });
	} catch {
		// Path doesn't exist — nothing to remove
	}

	symlinkSync(target, linkPath);
}

/**
 * Check if a path is a symlink (handles lstatSync safely for non-existent paths).
 */
function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

// --------------- PackageManager ---------------

/** Options accepted by all install methods. */
export interface BaseInstallOptions {
	/** Path to the agent's settings.json file. */
	settingsFilePath: string;
	/** Path to the extensions directory. */
	extensionsDir: string;
	/** Path to the git clone cache directory. */
	gitDir: string;
}

/** Options for --dev (symlink) install. */
export interface InstallDevOptions extends BaseInstallOptions {
	/** Absolute path to the local package checkout to symlink to. */
	localPath: string;
}

/** Options for --git (clone + symlink) install. */
export interface InstallGitOptions extends BaseInstallOptions {
	/** Git URL of the monorepo source. */
	sourceUrl: string;
	/** Subdirectory inside the repo containing packages (default: "packages"). */
	packagesRoot?: string;
}

/** Options for tarball install. */
export interface InstallTarballOptions extends BaseInstallOptions {
	/** Git URL of the monorepo source (for URL construction). */
	sourceUrl: string;
	/** Version of the package to install. */
	version: string;
	/** Monorepo-relative package path (e.g. "packages/pi-template"). */
	packagePath: string;
	/** Optional GitHub token for rate-limited downloads. */
	token?: string;
}

/** Options for remove. */
export interface RemoveOptions {
	/** Path to the agent's settings.json file. */
	settingsFilePath: string;
	/** Path to the extensions directory. */
	extensionsDir: string;
}

/** Options for update (tarball-only). */
export interface UpdateOptions {
	/** Path to the agent's settings.json file. */
	settingsFilePath: string;
	/** Path to the extensions directory. */
	extensionsDir: string;
	/** Git URL of the monorepo source. */
	sourceUrl: string;
	/** New version to update to. */
	version: string;
	/** Monorepo-relative package path (e.g. "packages/pi-template"). */
	packagePath: string;
	/** Optional GitHub token. */
	token?: string;
}

/**
 * Manages package lifecycle — install, remove, and update.
 *
 * Usage:
 *   const mgr = new PackageManager(state);
 *   const events = await mgr.installTarball("pi-template", opts);
 */
export class PackageManager {
	constructor(private state: RegistryState) {}

	/** Get current state (immutable snapshot). */
	getState(): Readonly<RegistryState> {
		return this.state;
	}

	/** Find an installed package by name. */
	findInstalled(packageName: string): InstalledPackage | undefined {
		return findInstalled(this.state, packageName);
	}

	/** List all installed packages. */
	listInstalled(): ReadonlyArray<InstalledPackage> {
		return this.state.installedPackages;
	}

	/**
	 * Install a package in --dev mode: symlink from extensions/<dirName> → localPath.
	 *
	 * @param packageName - Package name (e.g. "pi-template" or "@scope/pkg").
	 * @param sourceUrl - URL or path identifying the source (for tracking).
	 * @param options - Dev-specific install options.
	 * @returns Events for the caller to record.
	 * @throws Error if already installed or local path doesn't exist.
	 */
	async installDev(
		packageName: string,
		sourceUrl: string,
		options: InstallDevOptions,
	): Promise<RegistryEvent[]> {
		if (findInstalled(this.state, packageName)) {
			throw new Error(`Package "${packageName}" is already installed. Remove it first to reinstall.`);
		}

		if (!existsSync(options.localPath)) {
			throw new Error(
				`Local path does not exist: ${options.localPath}. Provide a valid path for --dev install.`,
			);
		}

		const dirName = packageNameToDirName(packageName);
		const extensionDir = join(options.extensionsDir, dirName);

		// Create symlink: extensions/<dirName> → localPath
		createSymlink(options.localPath, extensionDir);

		// Register extensions dir in settings
		await registerExtensionPath(options.settingsFilePath, options.extensionsDir);

		// Update state
		const now = new Date().toISOString();
		const installed: InstalledPackage = {
			name: packageName,
			sourceUrl,
			activationMode: "dev",
			installedAt: now,
			targetPath: options.localPath,
			extensionDir: dirName,
		};
		this.state.installedPackages.push(installed);

		return [
			{
				type: PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED,
				data: {
					packageName,
					activationMode: "dev",
					sourceUrl,
					targetPath: options.localPath,
					extensionDir: dirName,
					timestamp: now,
				},
			},
		];
	}

	/**
	 * Install a package in --git mode: clone/update source, symlink to package dir.
	 *
	 * @param packageName - Package name.
	 * @param sourceUrl - Git URL of the monorepo.
	 * @param options - Git-specific install options.
	 * @returns Events for the caller to record.
	 * @throws Error if already installed or clone fails.
	 */
	async installGit(
		packageName: string,
		sourceUrl: string,
		options: InstallGitOptions,
	): Promise<RegistryEvent[]> {
		if (findInstalled(this.state, packageName)) {
			throw new Error(`Package "${packageName}" is already installed. Remove it first to reinstall.`);
		}

		const packagesRoot = options.packagesRoot ?? "packages";
		const dirName = packageNameToDirName(packageName);

		// Clone or update the source repo
		const resolved = resolveSourceRoot(sourceUrl);
		const packagePath = join(resolved.rootPath, packagesRoot, dirName);

		if (!existsSync(packagePath)) {
			throw new Error(
				`Package directory not found in cloned source: ${packagePath}. ` +
				`Source: ${sourceUrl}, packagesRoot: ${packagesRoot}.`,
			);
		}

		const extensionDir = join(options.extensionsDir, dirName);

		// Create symlink: extensions/<dirName> → cloned package dir
		createSymlink(packagePath, extensionDir);

		// Register extensions dir in settings
		await registerExtensionPath(options.settingsFilePath, options.extensionsDir);

		// Update state
		const now = new Date().toISOString();
		const installed: InstalledPackage = {
			name: packageName,
			sourceUrl,
			activationMode: "git",
			installedAt: now,
			targetPath: packagePath,
			extensionDir: dirName,
		};
		this.state.installedPackages.push(installed);

		return [
			{
				type: PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED,
				data: {
					packageName,
					activationMode: "git",
					sourceUrl,
					targetPath: packagePath,
					extensionDir: dirName,
					timestamp: now,
				},
			},
		];
	}

	/**
	 * Install a package via tarball download from GitHub releases.
	 *
	 * @param packageName - Package name.
	 * @param source - MonorepoSource for URL resolution.
	 * @param options - Tarball-specific install options.
	 * @returns Events for the caller to record.
	 * @throws Error if already installed, URL resolution fails, or download fails.
	 */
	async installTarball(
		packageName: string,
		sourceUrl: string,
		options: InstallTarballOptions,
	): Promise<RegistryEvent[]> {
		if (findInstalled(this.state, packageName)) {
			throw new Error(`Package "${packageName}" is already installed. Remove it first to reinstall.`);
		}

		const dirName = packageNameToDirName(packageName);

		// Build a source-like object for URL resolution
		const source = {
			url: sourceUrl,
			shortName: "",
			packagesRoot: "packages",
			packages: [],
			lastUpdated: new Date().toISOString(),
			rootPath: sourceUrl,
		};

		// Resolve tarball URL
		const url = resolveTarballUrl(source, packageName, options.version, options.packagePath);

		// Download and extract to extensions dir
		const result = await downloadAndExtract(url, {
			targetDir: options.extensionsDir,
			token: options.token,
		});

		// Register extensions dir in settings
		await registerExtensionPath(options.settingsFilePath, options.extensionsDir);

		// Update state
		const now = new Date().toISOString();
		const installed: InstalledPackage = {
			name: packageName,
			sourceUrl,
			activationMode: "tarball",
			installedAt: now,
			targetPath: result.extractedPath,
			extensionDir: dirName,
		};
		this.state.installedPackages.push(installed);

		return [
			{
				type: PACKAGE_ENTRY_TYPES.PACKAGE_INSTALLED,
				data: {
					packageName,
					activationMode: "tarball",
					sourceUrl,
					version: options.version,
					tarballUrl: url,
					targetPath: result.extractedPath,
					extensionDir: dirName,
					timestamp: now,
				},
			},
		];
	}

	/**
	 * Remove an installed package.
	 *
	 * For --dev/--git modes: removes the symlink from extensions dir.
	 * For tarball mode: removes the extracted directory.
	 * Unregisters extensions dir from settings if no packages remain.
	 *
	 * @param packageName - Package to remove.
	 * @param options - Remove options with explicit paths.
	 * @returns Events for the caller to record.
	 * @throws Error if the package is not installed.
	 */
	async remove(
		packageName: string,
		options: RemoveOptions,
	): Promise<RegistryEvent[]> {
		const index = this.state.installedPackages.findIndex((p) => p.name === packageName);
		if (index === -1) {
			throw new Error(`Package "${packageName}" is not installed.`);
		}

		const pkg = this.state.installedPackages[index];
		const extensionPath = join(options.extensionsDir, pkg.extensionDir);

		// Remove the extension directory or symlink
		if (existsSync(extensionPath) || isSymlink(extensionPath)) {
			rmSync(extensionPath, { force: true, recursive: true });
		}

		// Remove from state
		this.state.installedPackages.splice(index, 1);

		// Unregister from settings if no packages remain
		if (this.state.installedPackages.length === 0) {
			await unregisterExtensionPath(options.settingsFilePath, options.extensionsDir);
		}

		return [
			{
				type: PACKAGE_ENTRY_TYPES.PACKAGE_REMOVED,
				data: {
					packageName,
					activationMode: pkg.activationMode,
					extensionDir: pkg.extensionDir,
					timestamp: new Date().toISOString(),
				},
			},
		];
	}

	/**
	 * Update a tarball-installed package to a new version.
	 *
	 * Downloads the new version to a temp location, then atomically swaps
	 * the old directory with the new one. Only works for tarball-activated packages.
	 *
	 * @param packageName - Package to update.
	 * @param options - Update options.
	 * @returns Events for the caller to record.
	 * @throws Error if the package is not installed, not tarball-activated, or download fails.
	 */
	async update(packageName: string, options: UpdateOptions): Promise<RegistryEvent[]> {
		const pkg = findInstalled(this.state, packageName);
		if (!pkg) {
			throw new Error(`Package "${packageName}" is not installed.`);
		}
		if (pkg.activationMode !== "tarball") {
			throw new Error(
				`Cannot update "${packageName}": update is only supported for tarball-activated packages ` +
				`(current mode: ${pkg.activationMode}). For dev/git packages, update the source directly.`,
			);
		}

		// Build a source-like object for URL resolution
		const source = {
			url: options.sourceUrl,
			shortName: "",
			packagesRoot: "packages",
			packages: [],
			lastUpdated: new Date().toISOString(),
			rootPath: options.sourceUrl,
		};

		// Resolve tarball URL for new version
		const url = resolveTarballUrl(source, packageName, options.version, options.packagePath);

		// Download to a temp directory
		const tempDir = join(options.extensionsDir, `.tmp-update-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		let extractedPath: string;
		try {
			const result = await downloadAndExtract(url, {
				targetDir: tempDir,
				token: options.token,
			});
			extractedPath = result.extractedPath;
		} catch (err) {
			// Clean up temp dir on failure
			rmSync(tempDir, { force: true, recursive: true });
			throw err;
		}

		// Atomic swap: rename old → .old, rename new → target, remove .old
		const currentPath = join(options.extensionsDir, pkg.extensionDir);
		const oldPath = `${currentPath}.old.${Date.now()}`;
		const newPath = extractedPath;

		try {
			// Move current out of the way
			if (existsSync(currentPath)) {
				renameSync(currentPath, oldPath);
			}

			// Move new version into place
			renameSync(newPath, currentPath);

			// Update state
			const now = new Date().toISOString();
			pkg.targetPath = currentPath;
			pkg.installedAt = now;

			return [
				{
					type: PACKAGE_ENTRY_TYPES.PACKAGE_UPDATED,
					data: {
						packageName,
						version: options.version,
						tarballUrl: url,
						targetPath: currentPath,
						timestamp: now,
					},
				},
			];
		} finally {
			// Always clean up old and temp directories
			if (existsSync(oldPath)) {
				rmSync(oldPath, { force: true, recursive: true });
			}
			if (existsSync(tempDir)) {
				rmSync(tempDir, { force: true, recursive: true });
			}
		}
	}
}
