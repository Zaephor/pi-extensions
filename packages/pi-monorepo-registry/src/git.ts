/**
 * Git utilities — clone and resolve monorepo sources from git URLs.
 *
 * Handles resolving a git URL to a local filesystem path by:
 * 1. Detecting when the URL matches the repo the extension is running from
 * 2. Cloning remote URLs to a cache directory under the agent data dir
 */

import { execSync } from "node:child_process";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getGitDir } from "./paths.js";

/**
 * Extract a short, human-friendly name from a git URL.
 * E.g. "https://github.com/Zaephor/pi-extensions.git" → "zaephor/pi-extensions"
 * E.g. "git@github.com:Zaephor/pi-extensions.git" → "zaephor/pi-extensions"
 * Falls back to the full URL for non-git paths.
 */
export function extractShortName(url: string): string {
	let normalized = url.trim();
	if (normalized.endsWith(".git")) {
		normalized = normalized.slice(0, -4);
	}
	normalized = normalized.replace(/\/+$/, "");

	// git@host:owner/repo
	const sshMatch = normalized.match(/^git@[^:]+:(.+)$/);
	if (sshMatch) {
		return sshMatch[1].toLowerCase();
	}

	// https://host/owner/repo
	const httpsMatch = normalized.match(/^https?:\/\/[^/]+\/(.+)$/);
	if (httpsMatch) {
		return httpsMatch[1].toLowerCase();
	}

	// ssh://git@host/owner/repo
	const sshProtoMatch = normalized.match(/^ssh:\/\/[^/]+\/(.+)$/);
	if (sshProtoMatch) {
		return sshProtoMatch[1].toLowerCase();
	}

	// Local path — use the directory name
	if (!normalized.includes("://") && !normalized.startsWith("git@")) {
		const parts = normalized.replace(/\/$/, "").split("/");
		return parts[parts.length - 1].toLowerCase();
	}

	return normalized.toLowerCase();
}

/**
 * Normalize a git URL for comparison purposes.
 * Strips trailing .git, normalizes GitHub HTTPS URLs, and converts SSH URLs
 * to HTTPS form so that `git@github.com:owner/repo` and
 * `https://github.com/owner/repo` compare equal.
 */
export function normalizeGitUrl(url: string): string {
	let normalized = url.trim();
	// Strip trailing .git
	if (normalized.endsWith(".git")) {
		normalized = normalized.slice(0, -4);
	}
	// Strip trailing slashes
	normalized = normalized.replace(/\/+$/, "");
	// Normalize SSH URLs to HTTPS form for comparison
	// git@github.com:owner/repo → https://github.com/owner/repo
	const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
	if (sshMatch) {
		normalized = `https://${sshMatch[1]}/${sshMatch[2]}`;
	}
	return normalized;
}

/**
 * Check if a URL looks like a git remote URL (https://, git://, ssh://, or user@host:path).
 */
export function isGitUrl(url: string): boolean {
	return /^(https?:\/\/|git:\/\/|ssh:\/\/|git@|[^/]+:[^/]+\/)/.test(url.trim());
}

/**
 * Generate a filesystem-safe directory name from a git URL.
 */
export function urlToDirName(url: string): string {
	const normalized = normalizeGitUrl(url);
	// Extract owner/repo from common patterns
	// https://github.com/owner/repo -> owner-repo
	// git@github.com:owner/repo -> owner-repo
	const httpsMatch = normalized.match(/:\/\/[^/]+\/([^/]+)\/([^/]+)$/);
	if (httpsMatch) {
		return `${httpsMatch[1]}-${httpsMatch[2]}`.replace(/[^a-zA-Z0-9._-]/g, "_");
	}
	// Fallback: hash the URL
	return normalized.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
}

/**
 * Get the monorepo root of the running extension.
 * Walks up from the current file to find the directory containing package.json
 * with workspaces (the monorepo root).
 *
 * Uses realpathSync to resolve any symlinks, ensuring the correct path
 * even when the extension is installed via symlink (e.g., dev mode).
 */
export function getExtensionMonorepoRoot(): string {
	// The extension runs from packages/pi-monorepo-registry/src/
	// So the monorepo root is 3 levels up from this file's directory.
	// Use import.meta.url for ESM-safe path resolution.
	const thisDir = new URL(".", import.meta.url).pathname;
	// Go up: src/ -> pi-monorepo-registry/ -> packages/ -> monorepo root
	const rawRoot = join(thisDir, "..", "..", "..");
	// Resolve symlinks so dev-mode installs point to the real monorepo root
	try {
		return realpathSync(rawRoot);
	} catch {
		return rawRoot;
	}
}

/**
 * Check if a given git URL matches the monorepo this extension is running from.
 * Compares normalized URLs (SSH and HTTPS forms are treated as equivalent).
 */
export function isSelfUrl(url: string): boolean {
	const normalizedInput = normalizeGitUrl(url);

	// Try to get the git remote URL from the extension's monorepo root
	const monorepoRoot = getExtensionMonorepoRoot();
	try {
		const remoteUrl = execSync("git remote get-url origin 2>/dev/null", {
			cwd: monorepoRoot,
			encoding: "utf-8",
		}).trim();
		if (normalizeGitUrl(remoteUrl) === normalizedInput) {
			return true;
		}
	} catch {
		// Not a git repo or no remote — can't match
	}

	return false;
}

/**
 * Resolve a source URL to a local filesystem path.
 *
 * - If the URL matches the running extension's monorepo, returns the local root.
 * - If the URL is a git remote, clones (or updates) to a cache directory.
 * - If the URL is already a local path, returns it as-is.
 *
 * @param url - Git URL or local path.
 * @returns Object with the resolved root path and whether it was cloned.
 */
export function resolveSourceRoot(url: string): { rootPath: string; cloned: boolean } {
	// Check if this is the repo we're already running from
	if (isGitUrl(url) && isSelfUrl(url)) {
		// Even for self-URLs, pull the latest to ensure versions are current
		const monorepoRoot = getExtensionMonorepoRoot();
		try {
			execSync("git pull --ff-only 2>/dev/null", {
				cwd: monorepoRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			// Pull failed (e.g., dirty working tree, no network) — use current checkout as-is
			console.warn(
				`[monorepo-registry] git pull failed for self-URL ${url}, using current checkout at ${monorepoRoot}`,
			);
		}
		return { rootPath: monorepoRoot, cloned: false };
	}

	// If it's not a git URL, treat as a local path
	if (!isGitUrl(url)) {
		// Resolve symlinks for local paths too
		try {
			return { rootPath: realpathSync(url), cloned: false };
		} catch {
			return { rootPath: url, cloned: false };
		}
	}

	// Clone or update the remote repo
	const cacheDir = getGitDir();
	const targetDir = join(cacheDir, urlToDirName(url));

	if (existsSync(join(targetDir, ".git"))) {
		// Update existing clone: fetch + reset to latest remote HEAD.
		// Use a robust strategy that works for both shallow and full clones.
		try {
			// Try to unshallow first (best effort — may fail on some hosts)
			try {
				execSync("git fetch --unshallow 2>/dev/null", {
					cwd: targetDir,
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch {
				// Not shallow or host doesn't support unshallow — continue
			}

			// Fetch all refs + prune stale branches (ensures origin/HEAD and branches are current)
			execSync("git fetch --all --prune --force", {
				cwd: targetDir,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});

			// Update origin/HEAD symbolic ref so `git rev-parse --abbrev-ref origin/HEAD` works
			try {
				execSync("git remote set-head origin --auto", {
					cwd: targetDir,
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch {
				// Some hosts don't support this — fallback below
			}

			// Determine the default branch (origin/HEAD may not exist on shallow clones)
			let defaultBranch: string;
			try {
				defaultBranch = execSync("git rev-parse --abbrev-ref origin/HEAD", {
					cwd: targetDir,
					encoding: "utf-8",
				}).trim();
			} catch {
				// Fallback: try common default branch names
				try {
					const branches = execSync("git branch -r", {
						cwd: targetDir,
						encoding: "utf-8",
					}).trim();
					if (branches.includes("origin/main")) {
						defaultBranch = "origin/main";
					} else if (branches.includes("origin/master")) {
						defaultBranch = "origin/master";
					} else {
						// Use the first remote branch
						defaultBranch = branches.split("\n")[0].trim();
					}
				} catch {
					defaultBranch = "origin/main";
				}
			}

			execSync(`git reset --hard ${defaultBranch}`, {
				cwd: targetDir,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});

			// Clean untracked files (deleted packages leave directories behind)
			execSync("git clean -fd", {
				cwd: targetDir,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err) {
			// If the update fails entirely, nuke and re-clone
			console.warn(
				`[monorepo-registry] Failed to update clone at ${targetDir}: ${err instanceof Error ? err.message : String(err)}. Re-cloning.`,
			);
			try {
				rmSync(targetDir, { force: true, recursive: true });
				execSync(`git clone --depth 1 "${url}" "${targetDir}"`, {
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch (cloneErr) {
				throw new Error(`Failed to clone ${url}: ${cloneErr instanceof Error ? cloneErr.message : String(cloneErr)}`);
			}
		}
	} else {
		// Clone
		execSync(`git clone --depth 1 "${url}" "${targetDir}"`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	return { rootPath: targetDir, cloned: true };
}
