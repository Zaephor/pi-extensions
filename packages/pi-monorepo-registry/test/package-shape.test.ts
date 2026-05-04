/**
 * Package shape tests — verify npm pack produces a correct tarball.
 *
 * Uses npm pack --json in the real package directory so we exercise the
 * actual packing code path, then asserts inclusion/exclusion rules and
 * required package.json fields.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");

let tmpDir: string | undefined;

afterAll(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

interface PackEntry {
	name: string;
	version: string;
	filename: string;
	files: Array<{ path: string; size: number }>;
}

/**
 * Run npm pack in the package directory and return the parsed JSON output.
 * npm pack --json writes the tarball and returns an array of entry objects.
 */
async function npmPack(): Promise<PackEntry> {
	tmpDir = mkdtempSync(join(tmpdir(), "pi-monorepo-registry-pack-"));

	const { stdout } = await execFileAsync("npm", ["pack", "--json"], {
		cwd: pkgDir,
		encoding: "utf-8",
	});

	const entries = JSON.parse(stdout);
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error(`Unexpected npm pack output: ${stdout}`);
	}
	return entries[0];
}

/** Read and parse the package.json from the pi-monorepo-registry package. */
function readPkgJson(): Record<string, unknown> {
	const raw = readFileSync(join(pkgDir, "package.json"), "utf-8");
	return JSON.parse(raw);
}

describe("package shape", () => {
	describe("package.json fields", () => {
		it('includes "files" allowlist containing src', () => {
			const pkg = readPkgJson();
			expect(pkg.files).toBeDefined();
			expect(Array.isArray(pkg.files)).toBe(true);
			expect(pkg.files).toContain("src");
		});

		it("has pi-package keyword", () => {
			const pkg = readPkgJson();
			expect(pkg.keywords).toBeDefined();
			expect(Array.isArray(pkg.keywords)).toBe(true);
			expect(pkg.keywords).toContain("pi-package");
		});

		it("has pi.extensions manifest", () => {
			const pkg = readPkgJson();
			expect(pkg.pi).toBeDefined();
			const pi = pkg.pi as Record<string, unknown>;
			expect(pi.extensions).toBeDefined();
			expect(Array.isArray(pi.extensions)).toBe(true);
			expect((pi.extensions as string[]).length).toBeGreaterThan(0);
		});

		it("has peerDependencies", () => {
			const pkg = readPkgJson();
			expect(pkg.peerDependencies).toBeDefined();
			expect(typeof pkg.peerDependencies).toBe("object");
			expect(Object.keys(pkg.peerDependencies as object).length).toBeGreaterThan(0);
		});
	});

	describe("tarball contents", () => {
		let result: PackEntry;
		let filePaths: string[];

		beforeAll(async () => {
			result = await npmPack();
			filePaths = result.files.map((f) => f.path);
		});

		const expectedFiles = [
			"src/index.ts",
			"src/discovery.ts",
			"src/registry.ts",
			"src/settings.ts",
			"src/persistence.ts",
			"src/types.ts",
			"src/paths.ts",
			"src/git.ts",
			"package.json",
			"README.md",
		];

		for (const file of expectedFiles) {
			it(`includes ${file}`, () => {
				expect(filePaths).toContain(file);
			});
		}

		it("excludes test/ files", () => {
			const testFiles = filePaths.filter((p) => p.startsWith("test/"));
			expect(testFiles).toEqual([]);
		});

		it("excludes node_modules/", () => {
			const nmFiles = filePaths.filter((p) => p.includes("node_modules"));
			expect(nmFiles).toEqual([]);
		});

		it("excludes dist/", () => {
			const distFiles = filePaths.filter((p) => p.startsWith("dist/"));
			expect(distFiles).toEqual([]);
		});

		it("excludes .tsbuildinfo files", () => {
			const tsbFiles = filePaths.filter((p) => p.endsWith(".tsbuildinfo"));
			expect(tsbFiles).toEqual([]);
		});
	});
});
