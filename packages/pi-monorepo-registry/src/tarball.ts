/**
 * Tarball download and extraction — downloads release tarballs from GitHub
 * and extracts them to the extensions directory.
 *
 * URL convention:
 *   https://github.com/{owner}/{repo}/releases/download/{tag}/{pkg-name}-{version}.tgz
 *
 * Tag format from release-please for monorepo packages:
 *   {name-with-dashes}-v{version}
 *   Nested paths use '--' for path separators, then '-v' before the version:
 *   e.g. pi-template-v0.2.0, @scope--my-pkg-v1.0.0
 *
 * No external dependencies — uses Node built-ins only.
 */

import { execSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import { URL } from "node:url";
import { getExtensionsDir } from "./paths.js";
import type { MonorepoSource } from "./types.js";

// --------------- URL construction ---------------

/**
 * Extract owner and repo from a GitHub URL.
 * Handles https://github.com/owner/repo(.git)? and git@github.com:owner/repo.git
 *
 * @returns `{ owner, repo }` or `null` if not a GitHub URL.
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
	let normalized = url.trim();
	if (normalized.endsWith(".git")) {
		normalized = normalized.slice(0, -4);
	}
	normalized = normalized.replace(/\/+$/, "");

	// git@github.com:owner/repo
	const sshMatch = normalized.match(/^git@([^:]+):([^/]+)\/([^/]+)$/);
	if (sshMatch) {
		if (sshMatch[1].toLowerCase() !== "github.com") return null;
		return { owner: sshMatch[2], repo: sshMatch[3] };
	}

	// https://github.com/owner/repo
	const httpsMatch = normalized.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
	if (httpsMatch) {
		if (httpsMatch[1].toLowerCase() !== "github.com") return null;
		return { owner: httpsMatch[2], repo: httpsMatch[3] };
	}

	return null;
}

/**
 * Build the release-please tag for a monorepo package path.
 *
 * "packages/pi-template" → "pi-template-v0.2.0"
 * "packages/@scope/my-pkg" → "@scope--my-pkg-v1.0.0"
 *
 * Release-please v4 produces tags with '-v' before the version.
 * Internal path slashes become '--', but the version separator is always '-v'.
 *
 * @param packagePath - The monorepo-relative package path (e.g. "packages/pi-template").
 * @param version - The semver version string (e.g. "0.2.0").
 */
export function buildReleaseTag(packagePath: string, version: string): string {
	const tagBody = packagePath.replace(/^packages\//, "").replace(/\//g, "--");
	return `${tagBody}-v${version}`;
}

/**
 * Construct the full tarball download URL.
 *
 * @param owner - GitHub repository owner.
 * @param repo - GitHub repository name.
 * @param tag - Release tag.
 * @param pkgName - Package name (from package.json `name` field).
 * @param version - Semver version.
 * @returns Full download URL.
 */
export function buildTarballUrl(owner: string, repo: string, tag: string, pkgName: string, version: string): string {
	const filename = `${pkgName}-${version}.tgz`;
	return `https://github.com/${owner}/${repo}/releases/download/${tag}/${filename}`;
}

/**
 * One-stop helper: resolve the download URL from a source + package metadata.
 *
 * @param source - Registered monorepo source (must be a GitHub URL).
 * @param packageName - Package name from package.json.
 * @param version - Semver version.
 * @param packagePath - Monorepo-relative path (e.g. "packages/pi-template").
 * @returns The download URL or throws if the source is not a GitHub URL.
 */
export function resolveTarballUrl(
	source: MonorepoSource,
	packageName: string,
	version: string,
	packagePath: string,
): string {
	const gh = parseGitHubUrl(source.url);
	if (!gh) {
		throw new Error(
			`Cannot resolve tarball URL: source "${source.shortName}" is not a GitHub repository (url: ${source.url})`,
		);
	}
	const tag = buildReleaseTag(packagePath, version);
	return buildTarballUrl(gh.owner, gh.repo, tag, packageName, version);
}

// --------------- Download ---------------

/** Options for downloading a tarball. */
export interface DownloadOptions {
	/** Target directory to extract into (defaults to getExtensionsDir()). */
	targetDir?: string;
	/** Optional GitHub token for rate limiting (read from env, never persisted). */
	token?: string;
	/** Timeout in milliseconds for the HTTP request (default: 30_000). */
	timeout?: number;
}

/** Result of a tarball download + extraction. */
export interface DownloadResult {
	/** Absolute path to the extracted package directory. */
	extractedPath: string;
	/** The tarball URL that was downloaded. */
	url: string;
	/** Size of the downloaded tarball in bytes. */
	size: number;
}

/**
 * Download a tarball from the given URL and extract it to the target directory.
 *
 * Uses Node's built-in https module (no external deps).
 * Extraction uses `tar -xzf` via child_process.execSync.
 *
 * @param url - The tarball download URL.
 * @param options - Download options.
 * @returns Information about the downloaded and extracted tarball.
 */
export async function downloadAndExtract(url: string, options: DownloadOptions = {}): Promise<DownloadResult> {
	const targetDir = options.targetDir ?? getExtensionsDir();
	const timeout = options.timeout ?? 30_000;

	// Ensure target directory exists
	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
	}

	// Parse URL to derive a temp file name
	const urlObj = new URL(url);
	const urlPathParts = urlObj.pathname.split("/");
	const tarballName = urlPathParts[urlPathParts.length - 1];
	if (!tarballName?.endsWith(".tgz")) {
		throw new Error(`Invalid tarball URL — cannot extract filename: ${url}`);
	}

	const tempTarball = join(targetDir, `.tmp-${tarballName}`);

	try {
		// Download
		const size = await downloadFile(url, tempTarball, {
			token: options.token,
			timeout,
		});

		// Extract
		const extractedPath = extractTarball(tempTarball, targetDir);

		return { extractedPath, url, size };
	} finally {
		// Clean up temp tarball
		if (existsSync(tempTarball)) {
			rmSync(tempTarball, { force: true });
		}
	}
}

// --------------- Internal helpers ---------------

/** Options for the low-level download. */
interface DownloadFileOptions {
	token?: string;
	timeout: number;
}

/**
 * Download a file via HTTPS to a local path.
 * Returns the size in bytes of the downloaded file.
 */
function downloadFile(url: string, destPath: string, options: DownloadFileOptions): Promise<number> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = {
			"User-Agent": "pi-monorepo-registry",
		};
		if (options.token) {
			headers.Authorization = `Bearer ${options.token}`;
		}

		const request = https.get(url, { headers, timeout: options.timeout }, (response) => {
			// Handle redirects (3xx)
			if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
				const location = response.headers.location;
				if (location) {
					response.resume(); // drain the redirect response
					downloadFile(location, destPath, options).then(resolve, reject);
					return;
				}
			}

			if (response.statusCode !== 200) {
				response.resume();
				const statusText = response.statusMessage ?? "Unknown";
				console.warn(`[tarball] Download failed: ${url} → HTTP ${response.statusCode} ${statusText}`);
				reject(new Error(`Tarball download failed: HTTP ${response.statusCode} ${statusText} — URL: ${url}`));
				return;
			}

			const fileStream = createWriteStream(destPath);
			let bytes = 0;
			response.on("data", (chunk: Buffer) => {
				bytes += chunk.length;
			});
			response.pipe(fileStream);

			fileStream.on("finish", () => {
				fileStream.close();
				resolve(bytes);
			});

			fileStream.on("error", (err) => {
				console.warn(`[tarball] File write error: ${destPath} — ${err.message}`);
				reject(new Error(`Failed to write tarball to ${destPath}: ${err.message}`));
			});
		});

		request.on("timeout", () => {
			request.destroy();
			console.warn(`[tarball] Download timed out after ${options.timeout}ms: ${url}`);
			reject(new Error(`Tarball download timed out after ${options.timeout}ms — URL: ${url}`));
		});

		request.on("error", (err) => {
			console.warn(`[tarball] Download error: ${url} — ${err.message}`);
			reject(new Error(`Tarball download error: ${err.message} — URL: ${url}`));
		});
	});
}

/**
 * Extract a .tgz tarball into the target directory using `tar`.
 *
 * The tarball is expected to contain a single top-level directory
 * (the package directory, e.g. "pi-template/").
 *
 * @param tarballPath - Path to the .tgz file.
 * @param targetDir - Directory to extract into.
 * @returns Absolute path to the extracted directory.
 */
export function extractTarball(tarballPath: string, targetDir: string): string {
	if (!existsSync(tarballPath)) {
		throw new Error(`Tarball not found: ${tarballPath}`);
	}

	try {
		// Extract into target dir; tarball contains a single top-level directory
		execSync(`tar -xzf "${tarballPath}" -C "${targetDir}"`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch (err: any) {
		const stderr = err.stderr ? String(err.stderr) : "";
		console.warn(`[tarball] Extract failed: ${tarballPath} → ${targetDir} — ${stderr}`);
		throw new Error(`Failed to extract tarball ${tarballPath} to ${targetDir}: ${stderr || err.message}`);
	}

	// Determine the extracted directory name.
	// tar -tzf lists entries; first entry is the top-level dir.
	let extractedDirName: string;
	try {
		const listing = execSync(`tar -tzf "${tarballPath}"`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const firstLine = listing.split("\n")[0]?.trim();
		// Strip trailing slash if present
		extractedDirName = firstLine?.replace(/\/$/, "") ?? "";
	} catch {
		// Fallback: derive from tarball filename
		const base = tarballPath.split("/").pop() ?? "";
		extractedDirName = base.replace(/-\d+\.\d+\.\d+\.tgz$/, "");
	}

	if (!extractedDirName) {
		throw new Error(`Could not determine extracted directory from tarball: ${tarballPath}`);
	}

	return join(targetDir, extractedDirName);
}
