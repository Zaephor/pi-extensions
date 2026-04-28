/**
 * Activation module — manages symlink-based package activation with
 * global and project-local scope support.
 *
 * Packages are "activated" by creating a symlink in pi's auto-discovery
 * extensions directory. Global scope uses ~/.pi/agent/extensions/, local
 * scope uses <cwd>/.pi/extensions/.
 */

import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ActivationInfo, Scope } from "./types.js";

/**
 * Resolve the extensions directory path for a given scope.
 *
 * @param scope - "global" for user-level, "local" for project-level.
 * @param cwd - Working directory (used for local scope). Defaults to process.cwd().
 * @returns Absolute path to the extensions directory.
 */
export function getExtensionsDir(scope: Scope, cwd?: string): string {
	const base = scope === "global" ? getAgentDir() : (cwd ?? process.cwd());
	return base.endsWith("/") ? `${base}extensions` : `${base}/extensions`;
}

/**
 * Create a symlink activating a package in pi's extensions directory.
 *
 * - Ensures the extensions directory exists (mkdir -p).
 * - If a symlink already exists pointing to the same target, returns success (idempotent).
 * - If a symlink already exists pointing elsewhere, throws with conflict details.
 *
 * @param packagePath - Absolute path to the package directory to activate.
 * @param packageName - Package name (used as the symlink filename).
 * @param scope - "global" or "local".
 * @param cwd - Working directory for local scope resolution.
 * @returns ActivationInfo describing the created activation.
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
 * @param packageName - Package name (symlink filename) to remove.
 * @param scope - "global" or "local".
 * @param cwd - Working directory for local scope resolution.
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
 *
 * @param packageName - Package name to check.
 * @param scope - "global" or "local".
 * @param cwd - Working directory for local scope resolution.
 * @returns true if an activation symlink exists for this package.
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
