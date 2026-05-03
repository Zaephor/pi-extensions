/**
 * Activation module — manages symlink-based package activation in the
 * registry's managed active/ directory, NOT in the standard extensions/ directory.
 *
 * Packages are "activated" by creating a symlink in:
 *   ~/.pi/agent/monorepo-registry/active/   (when running under pi)
 *   ~/.gsd/agent/monorepo-registry/active/  (when running under gsd)
 *
 * Path resolution is centralized in paths.ts — all scope-aware directory
 * logic lives there, not here.
 */

import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { getExtensionsDir } from "./paths.js";
import type { ActivationInfo, Scope } from "./types.js";

export { getExtensionsDir } from "./paths.js";

/**
 * Create a symlink activating a package in the registry's managed directory.
 *
 * - Ensures the directory exists (mkdir -p).
 * - If a symlink already exists pointing to the same target, returns success (idempotent).
 * - If a symlink already exists pointing elsewhere, throws with conflict details.
 */
export async function createActivationSymlink(
	packagePath: string,
	packageName: string,
	scope: Scope,
	cwd?: string,
): Promise<ActivationInfo> {
	const extensionsDir = getExtensionsDir(scope, cwd);
	const symlinkPath = `${extensionsDir}/${packageName}`;

	// Ensure parent directory of the symlink exists (handles scoped names like @scope/pkg)
	const symlinkDir = dirname(symlinkPath);
	await mkdir(symlinkDir, { recursive: true });

	// Check if symlink already exists
	let existingStat: Awaited<ReturnType<typeof lstat>> | undefined;
	try {
		existingStat = await lstat(symlinkPath);
	} catch {
		// Doesn't exist — proceed to create
	}

	if (existingStat) {
		// Something exists at the symlink path
		if (existingStat.isSymbolicLink()) {
			const currentTarget = await readlink(symlinkPath);
			if (currentTarget === packagePath) {
				// Idempotent: already pointing to the right target
				return {
					packageName,
					scope,
					symlinkPath,
					targetPath: packagePath,
					activatedAt: new Date().toISOString(),
				};
			}
			throw new Error(
				`Symlink conflict at ${symlinkPath}: already points to ${currentTarget}, cannot point to ${packagePath}`,
			);
		}
		throw new Error(`Cannot create symlink at ${symlinkPath}: a non-symlink entry already exists`);
	}

	// Create the symlink
	await symlink(packagePath, symlinkPath);

	return {
		packageName,
		scope,
		symlinkPath,
		targetPath: packagePath,
		activatedAt: new Date().toISOString(),
	};
}

/**
 * Remove an activation symlink for a package.
 *
 * @returns true if the symlink was removed, false if it didn't exist.
 */
export async function removeActivationSymlink(packageName: string, scope: Scope, cwd?: string): Promise<boolean> {
	const extensionsDir = getExtensionsDir(scope, cwd);
	const symlinkPath = `${extensionsDir}/${packageName}`;

	try {
		const stat = await lstat(symlinkPath);
		if (stat.isSymbolicLink()) {
			await unlink(symlinkPath);
			return true;
		}
		// Not a symlink — don't remove non-symlink entries
		return false;
	} catch {
		// Doesn't exist
		return false;
	}
}

/**
 * Check if a package is currently activated (symlink exists).
 */
export async function isActivated(packageName: string, scope: Scope, cwd?: string): Promise<boolean> {
	const extensionsDir = getExtensionsDir(scope, cwd);
	const symlinkPath = `${extensionsDir}/${packageName}`;

	try {
		const stat = await lstat(symlinkPath);
		return stat.isSymbolicLink();
	} catch {
		return false;
	}
}
