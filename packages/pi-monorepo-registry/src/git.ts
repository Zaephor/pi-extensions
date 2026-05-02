/**
 * Git utilities — clone and resolve monorepo sources from git URLs.
 *
 * Handles resolving a git URL to a local filesystem path by:
 * 1. Detecting when the URL matches the repo the extension is running from
 * 2. Cloning remote URLs to a cache directory under the agent data dir
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

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
 * Strips trailing .git, normalizes GitHub HTTPS URLs.
 */
export function normalizeGitUrl(url: string): string {
	let normalized = url.trim();
	// Strip trailing .git
	if (normalized.endsWith(".git")) {
		normalized = normalized.slice(0, -4);
	}
	// Strip trailing slashes
	normalized = normalized.replace(/\/+$/, "");
	return normalized;
}

/**
 * Check if a URL looks like a git remote URL (https://, git://, ssh://, or user@host:path).
 */
export function isGitUrl(url: string): boolean {
	return /^(https?:\/\/|git:\/\/|ssh:\/\/|git@|[^/]+:[^/]+\/)/.test(url.trim());
}

/**
 * Get a cache directory for cloned monorepo sources.
 */
export function getCloneCacheDir(): string {
	const agentDir = getAgentDir();
	return join(agentDir, "monorepo-registry", "sources");
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
 */
export function getExtensionMonorepoRoot(): string {
	// The extension runs from packages/pi-monorepo-registry/src/
	// So the monorepo root is 3 levels up from this file's directory.
	// Use import.meta.url for ESM-safe path resolution.
	const thisDir = new URL(".", import.meta.url).pathname;
	// Go up: src/ -> pi-monorepo-registry/ -> packages/ -> monorepo root
	return join(thisDir, "..", "..", "..");
}

/**
 * Check if a given git URL matches the monorepo this extension is running from.
 * Compares normalized URLs and also checks the local git remote.
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
		// Also check with https://github.com/ prefix normalization
		if (remoteUrl.startsWith("git@") && normalizedInput.startsWith("https://")) {
			// git@github.com:owner/repo -> https://github.com/owner/repo
			const sshMatch = remoteUrl.match(/^git@([^:]+):(.+)$/);
			if (sshMatch) {
				const httpsEquiv = `https://${sshMatch[1]}/${sshMatch[2]}`;
				if (normalizeGitUrl(httpsEquiv) === normalizedInput) {
					return true;
				}
			}
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
		return { rootPath: getExtensionMonorepoRoot(), cloned: false };
	}

	// If it's not a git URL, treat as a local path
	if (!isGitUrl(url)) {
		return { rootPath: url, cloned: false };
	}

	// Clone or update the remote repo
	const cacheDir = getCloneCacheDir();
	const targetDir = join(cacheDir, urlToDirName(url));

	if (existsSync(join(targetDir, ".git"))) {
		// Pull latest
		try {
			execSync("git pull --ff-only", {
				cwd: targetDir,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			// Pull failed — use existing clone, it may be offline
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
