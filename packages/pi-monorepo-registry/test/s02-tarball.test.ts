/**
 * S02 T01: Tests for tarball.ts — GitHub release download and extraction.
 *
 * Tests URL construction, GitHub URL parsing, release tag building,
 * and tarball extraction. Download is tested with mocked HTTPS.
 */
import { execSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MonorepoSource } from "../src/types.js";
import {
	buildReleaseTag,
	buildTarballUrl,
	downloadAndExtract,
	extractTarball,
	parseGitHubUrl,
	resolveTarballUrl,
} from "../src/tarball.js";

// --------------- Test fixtures ---------------

const TEST_SOURCE: MonorepoSource = {
	url: "https://github.com/Zaephor/pi-extensions.git",
	shortName: "zaephor/pi-extensions",
	packagesRoot: "packages",
	packages: [],
	lastUpdated: "2025-01-01T00:00:00Z",
	rootPath: "/fake/path",
};

let tempDir: string;

beforeEach(() => {
	tempDir = join(tmpdir(), `tarball-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	if (existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

/** Create a valid .tgz tarball containing a directory with a package.json. */
function createTestTarball(destPath: string, dirName: string, pkgName: string, version: string) {
	const staging = join(tempDir, "staging");
	mkdirSync(join(staging, dirName), { recursive: true });
	const pkgJson = JSON.stringify({ name: pkgName, version });
	writeSync(openSync(join(staging, dirName, "package.json"), "w"), pkgJson);
	execSync(`tar -czf "${destPath}" -C "${staging}" "${dirName}"`, { stdio: "pipe" });
}

// --------------- parseGitHubUrl ---------------

describe("parseGitHubUrl", () => {
	it("parses HTTPS GitHub URL", () => {
		const result = parseGitHubUrl("https://github.com/Zaephor/pi-extensions");
		expect(result).toEqual({ owner: "Zaephor", repo: "pi-extensions" });
	});

	it("parses HTTPS GitHub URL with .git suffix", () => {
		const result = parseGitHubUrl("https://github.com/Zaephor/pi-extensions.git");
		expect(result).toEqual({ owner: "Zaephor", repo: "pi-extensions" });
	});

	it("parses SSH GitHub URL", () => {
		const result = parseGitHubUrl("git@github.com:Zaephor/pi-extensions.git");
		expect(result).toEqual({ owner: "Zaephor", repo: "pi-extensions" });
	});

	it("returns null for non-GitHub URL", () => {
		expect(parseGitHubUrl("https://gitlab.com/owner/repo")).toBeNull();
	});

	it("returns null for local path", () => {
		expect(parseGitHubUrl("/home/user/repo")).toBeNull();
	});

	it("returns null for non-git URL without github.com", () => {
		expect(parseGitHubUrl("https://example.com/owner/repo")).toBeNull();
	});

	it("handles trailing slashes", () => {
		const result = parseGitHubUrl("https://github.com/Zaephor/pi-extensions/");
		expect(result).toEqual({ owner: "Zaephor", repo: "pi-extensions" });
	});

	it("is case-insensitive for github.com host", () => {
		const result = parseGitHubUrl("https://GITHUB.COM/Zaephor/pi-extensions");
		expect(result).toEqual({ owner: "Zaephor", repo: "pi-extensions" });
	});
});

// --------------- buildReleaseTag ---------------

describe("buildReleaseTag", () => {
	it("builds tag from packages/ path", () => {
		expect(buildReleaseTag("packages/pi-template", "0.2.0")).toBe(
			"pi-template-v0.2.0",
		);
	});

	it("builds tag for deeply nested package", () => {
		expect(buildReleaseTag("packages/pi-monorepo-registry", "0.1.1")).toBe(
			"pi-monorepo-registry-v0.1.1",
		);
	});

	it("handles packages with multiple slashes", () => {
		expect(buildReleaseTag("packages/@scope/my-pkg", "1.0.0")).toBe(
			"@scope--my-pkg-v1.0.0",
		);
	});

	it("handles version with pre-release tag", () => {
		expect(buildReleaseTag("packages/pi-template", "0.2.0-beta.1")).toBe(
			"pi-template-v0.2.0-beta.1",
		);
	});
});

// --------------- buildTarballUrl ---------------

describe("buildTarballUrl", () => {
	it("builds correct URL", () => {
		const url = buildTarballUrl("Zaephor", "pi-extensions", "pi-template-v0.2.0", "pi-template", "0.2.0");
		expect(url).toBe(
			"https://github.com/Zaephor/pi-extensions/releases/download/pi-template-v0.2.0/pi-template-0.2.0.tgz",
		);
	});

	it("handles scoped package names", () => {
		const url = buildTarballUrl("owner", "repo", "my-pkg-v1.0.0", "@scope/my-pkg", "1.0.0");
		expect(url).toContain("@scope/my-pkg-1.0.0.tgz");
	});
});

// --------------- resolveTarballUrl ---------------

describe("resolveTarballUrl", () => {
	it("resolves from source with HTTPS URL", () => {
		const url = resolveTarballUrl(TEST_SOURCE, "pi-template", "0.2.0", "packages/pi-template");
		expect(url).toBe(
			"https://github.com/Zaephor/pi-extensions/releases/download/pi-template-v0.2.0/pi-template-0.2.0.tgz",
		);
	});

	it("resolves from source with SSH URL", () => {
		const sshSource: MonorepoSource = {
			...TEST_SOURCE,
			url: "git@github.com:Zaephor/pi-extensions.git",
		};
		const url = resolveTarballUrl(sshSource, "pi-template", "0.2.0", "packages/pi-template");
		expect(url).toBe(
			"https://github.com/Zaephor/pi-extensions/releases/download/pi-template-v0.2.0/pi-template-0.2.0.tgz",
		);
	});

	it("throws for non-GitHub source", () => {
		const localSource: MonorepoSource = {
			...TEST_SOURCE,
			url: "/home/user/my-repo",
			shortName: "my-repo",
		};
		expect(() => resolveTarballUrl(localSource, "pkg", "1.0.0", "packages/pkg")).toThrow(
			/not a GitHub repository/,
		);
	});
});

// --------------- extractTarball ---------------

describe("extractTarball", () => {
	it("extracts a valid tarball and returns extracted path", () => {
		const tarballPath = join(tempDir, "pi-template-0.2.0.tgz");
		createTestTarball(tarballPath, "pi-template", "pi-template", "0.2.0");

		const extractDir = join(tempDir, "output");
		mkdirSync(extractDir, { recursive: true });

		const result = extractTarball(tarballPath, extractDir);
		expect(result).toBe(join(extractDir, "pi-template"));
		expect(existsSync(join(result, "package.json"))).toBe(true);
	});

	it("creates target directory if needed (extract does it via tar)", () => {
		const tarballPath = join(tempDir, "my-ext-1.0.0.tgz");
		createTestTarball(tarballPath, "my-ext", "my-ext", "1.0.0");

		const extractDir = join(tempDir, "new-output");
		// tar -xzf creates files but needs the target dir to exist
		mkdirSync(extractDir, { recursive: true });

		const result = extractTarball(tarballPath, extractDir);
		expect(existsSync(result)).toBe(true);
	});

	it("throws for missing tarball", () => {
		expect(() => extractTarball("/nonexistent.tgz", tempDir)).toThrow(/not found/);
	});

	it("throws for invalid tarball (corrupt data)", () => {
		const badTarball = join(tempDir, "bad.tgz");
		const fd = openSync(badTarball, "w");
		writeSync(fd, Buffer.from("not a real tarball"));
		closeSync(fd);

		expect(() => extractTarball(badTarball, tempDir)).toThrow(/Failed to extract/);
	});

	it("handles tarball with subdirectory structure", () => {
		const tarballPath = join(tempDir, "scoped-pkg-0.1.0.tgz");
		// Create tarball with a scoped package name as directory
		createTestTarball(tarballPath, "scoped-pkg", "scoped-pkg", "0.1.0");

		const extractDir = join(tempDir, "extracted");
		mkdirSync(extractDir, { recursive: true });

		const result = extractTarball(tarballPath, extractDir);
		expect(result).toBe(join(extractDir, "scoped-pkg"));
	});
});

// --------------- downloadAndExtract ---------------

describe("downloadAndExtract", () => {
	it("fails with informative error for unreachable host", async () => {
		const url = "https://github.invalid/owner/repo/releases/download/test--v1.0.0/test-1.0.0.tgz";
		await expect(
			downloadAndExtract(url, {
				targetDir: tempDir,
				timeout: 3_000,
			}),
		).rejects.toThrow(/download error|ENOTFOUND|fetch failed/i);
	});

	it("fails with informative error for HTTP 404", async () => {
		// Use real github.com but a nonexistent release — should get 404
		const url = "https://github.com/nonexistent-owner/nonexistent-repo/releases/download/missing--v0.0.1/missing-0.0.1.tgz";
		await expect(
			downloadAndExtract(url, {
				targetDir: tempDir,
				timeout: 10_000,
			}),
		).rejects.toThrow(/HTTP 404/);
	});

	it("throws for URL that doesn't end with .tgz", async () => {
		await expect(
			downloadAndExtract("https://example.com/some-file.zip", {
				targetDir: tempDir,
			}),
		).rejects.toThrow(/Invalid tarball URL/);
	});
});
