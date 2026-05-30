/**
 * Tests for scripts/create-extension.js — name validation, file generation,
 * root config updates, and cleanup behavior.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const scaffoldScript = resolve(rootDir, "scripts/create-extension.js");
const packagesDir = resolve(rootDir, "packages");
const tsconfigPath = resolve(rootDir, "tsconfig.json");
const manifestPath = resolve(rootDir, ".release-please-manifest.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScaffoldResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** Run the scaffold script with the given argument(s) and capture results. */
function execScaffold(...args: string[]): Promise<ScaffoldResult> {
	return new Promise((resolve) => {
		execFile("node", [scaffoldScript, ...args], { cwd: rootDir }, (error, stdout, stderr) => {
			resolve({
				exitCode: error ? (error.code ?? 1) : 0,
				stdout: stdout ?? "",
				stderr: stderr ?? "",
			});
		});
	});
}

/** Remove a test extension directory if it exists. */
function cleanupExtension(name: string) {
	const pkgDir = resolve(packagesDir, name);
	if (existsSync(pkgDir)) {
		rmSync(pkgDir, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Config snapshots — saved once in beforeAll, restored in afterAll
// ---------------------------------------------------------------------------

let originalTsconfig: string;
let originalManifest: string;

const allTestExtensions = ["test-validation-ext", "test-gen-ext", "test-dup-ext", "test-stateful-ext", "test-hook-ext"];

beforeAll(() => {
	originalTsconfig = readFileSync(tsconfigPath, "utf-8");
	originalManifest = readFileSync(manifestPath, "utf-8");
});

afterAll(() => {
	// Final cleanup — restore configs and remove all test extension directories
	writeFileSync(tsconfigPath, originalTsconfig);
	writeFileSync(manifestPath, originalManifest);

	for (const name of allTestExtensions) {
		cleanupExtension(name);
	}

	// Also sweep for any leftover test-* directories
	const entries = existsSync(packagesDir) ? readdirSync(packagesDir) : [];
	for (const entry of entries) {
		if (entry.startsWith("test-") && entry !== "test-helpers") {
			cleanupExtension(entry);
		}
	}
});

// ---------------------------------------------------------------------------
// Name validation tests
// ---------------------------------------------------------------------------

describe("create-extension name validation", () => {
	afterEach(() => {
		// Clean up any extension created during validation tests
		for (const name of ["test-dup-ext", "test-validation-ext"]) {
			cleanupExtension(name);
		}
		// Restore configs (scaffolded extensions update root configs)
		writeFileSync(tsconfigPath, originalTsconfig);
		writeFileSync(manifestPath, originalManifest);
	});

	it("rejects missing argument with usage message", async () => {
		const result = await execScaffold();
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Usage");
	});

	it("rejects empty string argument with usage message", async () => {
		const result = await execScaffold("");
		expect(result.exitCode).toBe(1);
		// Empty string is falsy, so the script hits the !name check → Usage message
		expect(result.stderr).toContain("Usage");
	});

	it("rejects uppercase name", async () => {
		const result = await execScaffold("MyTool");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("lowercase");
	});

	it("rejects name with leading dot", async () => {
		const result = await execScaffold(".hidden");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("must not start");
	});

	it("rejects name with leading underscore", async () => {
		const result = await execScaffold("_private");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("must not start");
	});

	it("rejects reserved name pi-template", async () => {
		const result = await execScaffold("pi-template");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("reserved");
	});

	it("rejects reserved name pi-template-stateful", async () => {
		const result = await execScaffold("pi-template-stateful");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("reserved");
	});

	it("rejects reserved name pi-template-hook", async () => {
		const result = await execScaffold("pi-template-hook");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("reserved");
	});

	it("rejects unknown --template value", async () => {
		const result = await execScaffold("test-validation-ext", "--template", "does-not-exist");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Template");
		expect(result.stderr).toContain("not found");
	});

	it("rejects --template with no value", async () => {
		const result = await execScaffold("test-validation-ext", "--template");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("--template requires a value");
	});

	it("rejects unknown flags", async () => {
		const result = await execScaffold("test-validation-ext", "--bogus");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Unknown flag");
	});

	it("rejects duplicate directory", async () => {
		// First scaffold should succeed
		const first = await execScaffold("test-dup-ext");
		expect(first.exitCode).toBe(0);

		// Second scaffold of same name should fail
		const second = await execScaffold("test-dup-ext");
		expect(second.exitCode).toBe(1);
		expect(second.stderr).toContain("already exists");
	});

	it("accepts valid lowercase-hyphenated name", async () => {
		const result = await execScaffold("test-validation-ext");
		expect(result.exitCode).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// File generation tests
// ---------------------------------------------------------------------------

describe("create-extension file generation", () => {
	const extName = "test-gen-ext";
	const pkgDir = resolve(packagesDir, extName);

	const expectedFiles = [
		"package.json",
		"tsconfig.json",
		"src/index.ts",
		"README.md",
		"test/helpers/mock-api.ts",
		"test/index.test.ts",
		"test/unit.test.ts",
		"test/integration.test.ts",
		"test/package-shape.test.ts",
		"test/sdk-e2e.test.ts",
	];

	// Scaffold once for the entire describe block
	beforeAll(async () => {
		const result = await execScaffold(extName);
		expect(result.exitCode).toBe(0);
	});

	// Cleanup after the entire describe block
	afterAll(() => {
		cleanupExtension(extName);
	});

	it("creates all 10 expected files", () => {
		for (const file of expectedFiles) {
			const filePath = resolve(pkgDir, file);
			expect(existsSync(filePath), `Missing file: ${file}`).toBe(true);
		}
	});

	describe("package.json content", () => {
		let pkgJson: Record<string, any>;

		beforeAll(() => {
			pkgJson = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf-8"));
		});

		it("has correct scoped name", () => {
			expect(pkgJson.name).toBe(extName);
		});

		it("has pi-package keyword", () => {
			expect(pkgJson.keywords).toContain("pi-package");
		});

		it("has pi.extensions array", () => {
			expect(pkgJson.pi).toBeDefined();
			expect(Array.isArray(pkgJson.pi.extensions)).toBe(true);
			expect(pkgJson.pi.extensions.length).toBeGreaterThan(0);
		});

		it("has peerDependencies with pi packages", () => {
			expect(pkgJson.peerDependencies).toBeDefined();
			const deps = Object.keys(pkgJson.peerDependencies);
			expect(deps.length).toBeGreaterThan(0);
		});

		it('has files allowlist containing "src"', () => {
			expect(pkgJson.files).toBeDefined();
			expect(pkgJson.files).toContain("src");
		});
	});

	describe("tsconfig.json content", () => {
		let tsconfig: Record<string, any>;

		beforeAll(() => {
			tsconfig = JSON.parse(readFileSync(resolve(pkgDir, "tsconfig.json"), "utf-8"));
		});

		it("extends shared base config", () => {
			expect(tsconfig.extends).toBe("../../shared/tsconfig.base.json");
		});

		it("has composite enabled", () => {
			expect(tsconfig.compilerOptions?.composite).toBe(true);
		});
	});

	describe("src/index.ts content", () => {
		let srcContent: string;

		beforeAll(() => {
			srcContent = readFileSync(resolve(pkgDir, "src/index.ts"), "utf-8");
		});

		it("imports defineTool", () => {
			expect(srcContent).toContain("defineTool");
		});

		it("subscribes to session_start", () => {
			expect(srcContent).toContain("session_start");
		});

		it("contains the extension name", () => {
			expect(srcContent).toContain(extName);
		});
	});

	describe("README.md content", () => {
		let readme: string;

		beforeAll(() => {
			readme = readFileSync(resolve(pkgDir, "README.md"), "utf-8");
		});

		it("contains extension name", () => {
			expect(readme).toContain(extName);
		});

		it("contains installation instructions", () => {
			expect(readme).toContain("pi install");
		});
	});
});

// ---------------------------------------------------------------------------
// --template flag tests
// ---------------------------------------------------------------------------

describe("create-extension --template flag", () => {
	const statefulExt = "test-stateful-ext";
	const hookExt = "test-hook-ext";

	afterEach(() => {
		cleanupExtension(statefulExt);
		cleanupExtension(hookExt);
		writeFileSync(tsconfigPath, originalTsconfig);
		writeFileSync(manifestPath, originalManifest);
	});

	it("scaffolds from pi-template-stateful and copies the counter tool", async () => {
		const result = await execScaffold(statefulExt, "--template", "pi-template-stateful");
		expect(result.exitCode).toBe(0);

		const srcPath = resolve(packagesDir, statefulExt, "src/index.ts");
		expect(existsSync(srcPath)).toBe(true);
		const src = readFileSync(srcPath, "utf-8");
		// The stateful template's domain artefacts must survive the copy.
		expect(src).toContain("counter");
		expect(src).toContain("reconstructCount");
		// The package name is substituted; original template name should be gone.
		expect(src).not.toContain("pi-template-stateful");
		expect(src).toContain(statefulExt);
	});

	it("scaffolds from pi-template-hook and copies the redact helper", async () => {
		const result = await execScaffold(hookExt, "--template", "pi-template-hook");
		expect(result.exitCode).toBe(0);

		const srcPath = resolve(packagesDir, hookExt, "src/index.ts");
		expect(existsSync(srcPath)).toBe(true);
		const src = readFileSync(srcPath, "utf-8");
		expect(src).toContain("redact");
		expect(src).toContain("tool_call");
		expect(src).not.toContain("pi-template-hook");
		expect(src).toContain(hookExt);
	});

	it("--template=<name> equals-form is accepted", async () => {
		const result = await execScaffold(statefulExt, "--template=pi-template-stateful");
		expect(result.exitCode).toBe(0);
		expect(existsSync(resolve(packagesDir, statefulExt, "src/index.ts"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Root config update tests
// ---------------------------------------------------------------------------

describe("create-extension root config updates", () => {
	const extName = "test-gen-ext";

	// This describe's beforeAll runs AFTER the file generation describe's
	// afterAll cleanup. We scaffold fresh here for config testing.
	beforeAll(async () => {
		const result = await execScaffold(extName);
		expect(result.exitCode).toBe(0);
	});

	afterAll(() => {
		cleanupExtension(extName);
	});

	it("adds reference to root tsconfig.json", () => {
		const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8"));
		const hasRef = tsconfig.references.some((ref: { path: string }) => ref.path === `packages/${extName}`);
		expect(hasRef).toBe(true);
	});

	it("adds entry to .release-please-manifest.json", () => {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		expect(manifest[`packages/${extName}`]).toBe("0.0.0");
	});

	it("adds entry to release-please-config.json", () => {
		const configPath = resolve(rootDir, "release-please-config.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(config.packages[`packages/${extName}`]).toEqual({
			"release-type": "node",
			"changelog-type": "default",
		});
	});
});
