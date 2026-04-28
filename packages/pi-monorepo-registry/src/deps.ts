/**
 * Deps module — node_modules staleness detection and automatic npm install.
 *
 * Checks whether a monorepo's node_modules directory is missing/stale
 * and runs npm install when needed.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Result of an ensureNodeModules check. */
export interface EnsureResult {
	/** Whether npm install was run. */
	installed: boolean;
	/** Output from npm install (empty if not run). */
	output: string;
}

/**
 * Check if a monorepo's node_modules directory is missing (stale).
 *
 * @param monorepoRoot - Absolute path to the monorepo root.
 * @returns true if node_modules is missing, false if it exists.
 */
export function isNodeModulesStale(monorepoRoot: string): boolean {
	return !existsSync(join(monorepoRoot, "node_modules"));
}

/**
 * Ensure node_modules exists by running npm install if stale.
 *
 * @param monorepoRoot - Absolute path to the monorepo root.
 * @param execFn - Override for execSync (useful for testing). Defaults to real execSync.
 * @returns Object indicating whether install was run and the output.
 * @throws Error with exit code and stderr if npm install fails.
 */
export function ensureNodeModules(monorepoRoot: string, execFn: typeof execSync = execSync): EnsureResult {
	if (!isNodeModulesStale(monorepoRoot)) {
		return { installed: false, output: "" };
	}

	try {
		const output = execFn("npm install --omit=dev", {
			cwd: monorepoRoot,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { installed: true, output };
	} catch (err: unknown) {
		const error = err as { status?: number; stderr?: string; message?: string };
		throw new Error(
			`npm install failed (exit code ${error.status ?? "unknown"}): ${error.stderr ?? error.message ?? String(err)}`,
		);
	}
}
