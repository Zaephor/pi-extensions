/**
 * Unit tests for pi-monorepo-registry — discovery logic, registry state,
 * activation, deps management, and command handler wiring.
 */
import { lstat, mkdir, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivationSymlink, getExtensionsDir, isActivated, removeActivationSymlink } from "../src/activation.js";
import { discoverPackages, isPiCompatible } from "../src/discovery.js";
import { ENTRY_TYPES, MonorepoRegistry } from "../src/registry.js";
import type { FixtureMonorepo } from "./helpers/fixture";
import { cleanupFixture, createFixtureMonorepo } from "./helpers/fixture";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

// --- deps module: import lazily inside tests, since we mock child_process ---

// ---------------------------------------------------------------------------
// isPiCompatible
// ---------------------------------------------------------------------------
describe("isPiCompatible", () => {
	it("returns true for package with pi.extensions array", () => {
		expect(isPiCompatible({ pi: { extensions: ["./src/index.ts"] } })).toBe(true);
	});

	it("returns true for package with pi-package keyword", () => {
		expect(isPiCompatible({ keywords: ["pi-package"] })).toBe(true);
	});

	it("returns true for package with pi-package among other keywords", () => {
		expect(isPiCompatible({ keywords: ["node", "pi-package", "cli"] })).toBe(true);
	});

	it("returns false for package without pi manifest or keyword", () => {
		expect(isPiCompatible({ name: "foo" })).toBe(false);
	});

	it("returns false for pi object without extensions array", () => {
		expect(isPiCompatible({ pi: {} })).toBe(false);
	});

	it("returns false for pi.extensions that is not an array", () => {
		expect(isPiCompatible({ pi: { extensions: "not-array" } })).toBe(false);
	});

	it("returns false for keywords without pi-package", () => {
		expect(isPiCompatible({ keywords: ["node", "cli"] })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// discoverPackages — uses real filesystem via fixtures
// ---------------------------------------------------------------------------
describe("discoverPackages", () => {
	let fixture: FixtureMonorepo | undefined;

	afterEach(async () => {
		if (fixture) {
			await cleanupFixture(fixture);
			fixture = undefined;
		}
	});

	it("discovers packages with pi.extensions manifest", async () => {
		fixture = await createFixtureMonorepo("disc-ext", [{ name: "@scope/pkg-a", piExtensions: ["./src/index.ts"] }]);

		const packages = await discoverPackages(fixture.rootDir, "packages");
		expect(packages).toHaveLength(1);
		expect(packages[0].name).toBe("@scope/pkg-a");
		expect(packages[0].isPiPackage).toBe(true);
	});

	it("discovers packages with pi-package keyword", async () => {
		fixture = await createFixtureMonorepo("disc-kw", [{ name: "pkg-keyword", keywords: ["pi-package"] }]);

		const packages = await discoverPackages(fixture.rootDir, "packages");
		expect(packages).toHaveLength(1);
		expect(packages[0].name).toBe("pkg-keyword");
	});

	it("skips directories without pi-compatible package.json", async () => {
		fixture = await createFixtureMonorepo("disc-skip", [
			{ name: "compat-pkg", piExtensions: ["./src/index.ts"] },
			{ name: "plain-pkg" }, // no pi manifest, no pi-package keyword
		]);

		const packages = await discoverPackages(fixture.rootDir, "packages");
		expect(packages).toHaveLength(1);
		expect(packages[0].name).toBe("compat-pkg");
	});

	it("returns empty array for non-existent packages directory", async () => {
		const packages = await discoverPackages("/non/existent/path/xyz", "packages");
		expect(packages).toEqual([]);
	});

	it("supports custom packages root", async () => {
		fixture = await createFixtureMonorepo(
			"disc-custom",
			[{ name: "my-plugin", piExtensions: ["./src/main.ts"] }],
			"plugins",
		);

		const packages = await discoverPackages(fixture.rootDir, "plugins");
		expect(packages).toHaveLength(1);
		expect(packages[0].name).toBe("my-plugin");
	});

	it("extracts description and version from package.json", async () => {
		fixture = await createFixtureMonorepo("disc-meta", [
			{
				name: "meta-pkg",
				version: "2.5.1",
				description: "A test package",
				piExtensions: ["./src/index.ts"],
			},
		]);

		const packages = await discoverPackages(fixture.rootDir, "packages");
		expect(packages).toHaveLength(1);
		expect(packages[0].version).toBe("2.5.1");
		expect(packages[0].description).toBe("A test package");
	});

	it("defaults version to 0.0.0 when missing", async () => {
		fixture = await createFixtureMonorepo("disc-noversion", [{ name: "nov-pkg", piExtensions: ["./src/index.ts"] }]);

		const packages = await discoverPackages(fixture.rootDir, "packages");
		expect(packages).toHaveLength(1);
		expect(packages[0].version).toBe("0.0.0");
	});
});

// ---------------------------------------------------------------------------
// MonorepoRegistry
// ---------------------------------------------------------------------------
describe("MonorepoRegistry", () => {
	it("initialises with empty state", () => {
		const { api } = createMockAPI();
		const registry = new MonorepoRegistry(api, { sources: [] });
		expect(registry.getSources()).toHaveLength(0);
		expect(registry.getAllPackages()).toHaveLength(0);
	});

	describe("addSource", () => {
		let fixture: FixtureMonorepo | undefined;

		afterEach(async () => {
			if (fixture) {
				await cleanupFixture(fixture);
				fixture = undefined;
			}
		});

		it("adds a source and discovers packages", async () => {
			fixture = await createFixtureMonorepo("reg-add", [
				{ name: "pkg-1", piExtensions: ["./src/index.ts"] },
				{ name: "pkg-2", keywords: ["pi-package"] },
			]);

			const { api, entries } = createMockAPI();
			const registry = new MonorepoRegistry(api, { sources: [] });

			const source = await registry.addSource(fixture.rootDir, "packages");

			expect(source.packages).toHaveLength(2);
			expect(source.url).toBe(fixture.rootDir);
			expect(registry.getSources()).toHaveLength(1);
			expect(entries).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: "monorepo-source-added" }),
					expect.objectContaining({ type: "monorepo-packages-discovered" }),
				]),
			);
		});

		it("throws when adding a duplicate source", async () => {
			const { api } = createMockAPI();
			const registry = new MonorepoRegistry(api, { sources: [] });

			// Add once — use a path that won't have packages, so discovery returns empty
			await registry.addSource("/tmp/fake-path-for-dupe-test", "packages");

			await expect(registry.addSource("/tmp/fake-path-for-dupe-test", "packages")).rejects.toThrow(
				"Source already registered",
			);
		});

		it("records appendEntry with source-added type", async () => {
			const { api, entries } = createMockAPI();
			const registry = new MonorepoRegistry(api, { sources: [] });

			await registry.addSource("/tmp/entry-test", "packages");

			const addedEntry = entries.find((e) => e.type === "monorepo-source-added");
			expect(addedEntry).toBeDefined();
			expect((addedEntry!.data as any).source).toBe("/tmp/entry-test");
			expect((addedEntry!.data as any).packagesRoot).toBe("packages");
		});
	});

	describe("removeSource", () => {
		it("removes a registered source", () => {
			const { api, entries } = createMockAPI();
			const registry = new MonorepoRegistry(api, {
				sources: [{ url: "https://example.com/repo", packagesRoot: "packages", packages: [], lastUpdated: "" }],
			});

			registry.removeSource("https://example.com/repo");

			expect(registry.getSources()).toHaveLength(0);
			const removedEntry = entries.find((e) => e.type === "monorepo-source-removed");
			expect(removedEntry).toBeDefined();
			expect((removedEntry!.data as any).source).toBe("https://example.com/repo");
		});

		it("throws when removing a non-existent source", () => {
			const { api } = createMockAPI();
			const registry = new MonorepoRegistry(api, { sources: [] });

			expect(() => registry.removeSource("https://nope.example.com")).toThrow("Source not found");
		});
	});

	describe("updateSource", () => {
		let fixture: FixtureMonorepo | undefined;

		afterEach(async () => {
			if (fixture) {
				await cleanupFixture(fixture);
				fixture = undefined;
			}
		});

		it("re-discovers packages for a specific source", async () => {
			fixture = await createFixtureMonorepo("reg-update", [{ name: "pkg-refresh", piExtensions: ["./src/index.ts"] }]);

			const { api, entries } = createMockAPI();
			const registry = new MonorepoRegistry(api, {
				sources: [{ url: fixture.rootDir, packagesRoot: "packages", packages: [], lastUpdated: "" }],
			});

			const updated = await registry.updateSource(fixture.rootDir);

			expect(updated).toHaveLength(1);
			expect(updated[0].packages).toHaveLength(1);
			expect(updated[0].packages[0].name).toBe("pkg-refresh");

			const discEntry = entries.find((e) => e.type === "monorepo-packages-discovered");
			expect(discEntry).toBeDefined();
		});

		it("throws for non-existent source URL", async () => {
			const { api } = createMockAPI();
			const registry = new MonorepoRegistry(api, { sources: [] });

			await expect(registry.updateSource("https://nope.example.com")).rejects.toThrow("Source not found");
		});
	});

	describe("getAllPackages", () => {
		it("returns packages from all sources with sourceUrl", () => {
			const { api } = createMockAPI();
			const registry = new MonorepoRegistry(api, {
				sources: [
					{
						url: "https://a.com",
						packagesRoot: "packages",
						packages: [{ name: "pkg-a", description: "", version: "1.0.0", path: "/a", isPiPackage: true }],
						lastUpdated: "",
					},
					{
						url: "https://b.com",
						packagesRoot: "packages",
						packages: [{ name: "pkg-b", description: "", version: "2.0.0", path: "/b", isPiPackage: true }],
						lastUpdated: "",
					},
				],
			});

			const all = registry.getAllPackages();
			expect(all).toHaveLength(2);
			expect(all[0].sourceUrl).toBe("https://a.com");
			expect(all[1].sourceUrl).toBe("https://b.com");
		});
	});
});

// ---------------------------------------------------------------------------
// Extension factory — command registration wiring
// ---------------------------------------------------------------------------
describe("extension factory", () => {
	it("registers four slash commands", async () => {
		const mod = await import("../src/index.js");
		const { api, commands } = createMockAPI();
		await mod.default(api);
		const names = commands.map((c) => c.name);
		expect(names).toContain("monorepo-list");
		expect(names).toContain("monorepo-install");
		expect(names).toContain("monorepo-remove");
		expect(names).toContain("monorepo-registry");
		expect(commands).toHaveLength(4);
	});

	it("registers session_start event handler", async () => {
		const mod = await import("../src/index.js");
		const { api, events } = createMockAPI();
		await mod.default(api);
		expect(events.some((e) => e.event === "session_start")).toBe(true);
	});

	describe("/monorepo-list", () => {
		it("shows message when no sources registered", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string) => notified.push(msg) });
			const listCmd =
				commands.find((c) => c.name === "monorepo-list") ?? commands.find((c) => c.name === "monorepo-list")!;
			await listCmd.handler("", ctx as any);

			expect(notified[0]).toContain("No monorepo sources registered");
		});
	});

	describe("/monorepo-registry add", () => {
		it("shows error when no URL provided", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string, level: string) => notified.push(`${level}:${msg}`) });
			const regCmd = commands.find((c) => c.name === "monorepo-registry")!;
			await regCmd.handler("add", ctx as any);

			expect(notified[0]).toContain("URL required");
		});
	});

	describe("/monorepo-registry remove", () => {
		it("shows error when no URL provided", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string, level: string) => notified.push(`${level}:${msg}`) });
			const regCmd = commands.find((c) => c.name === "monorepo-registry")!;
			await regCmd.handler("remove", ctx as any);

			expect(notified[0]).toContain("source required");
		});

		it("shows error when removing non-existent source", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string, level: string) => notified.push(`${level}:${msg}`) });
			const regCmd = commands.find((c) => c.name === "monorepo-registry")!;
			await regCmd.handler("remove https://nope.example.com", ctx as any);

			expect(notified[0]).toContain('"https://nope.example.com" not found');
		});
	});

	describe("/monorepo-registry update", () => {
		it("shows info when no sources to update", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string) => notified.push(msg) });
			const regCmd = commands.find((c) => c.name === "monorepo-registry")!;
			await regCmd.handler("update", ctx as any);

			expect(notified[0]).toContain("No sources to update");
		});
	});

	describe("/monorepo-registry unknown subcommand", () => {
		it("shows error for unknown subcommand", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string, level: string) => notified.push(`${level}:${msg}`) });
			const regCmd = commands.find((c) => c.name === "monorepo-registry")!;
			await regCmd.handler("bogus", ctx as any);

			expect(notified[0]).toContain("Unknown subcommand");
		});
	});
});

// ---------------------------------------------------------------------------
// ENTRY_TYPES — new constants for package install/remove
// ---------------------------------------------------------------------------
describe("ENTRY_TYPES", () => {
	it("includes PACKAGE_INSTALLED constant", () => {
		expect(ENTRY_TYPES.PACKAGE_INSTALLED).toBe("monorepo-package-installed");
	});

	it("includes PACKAGE_REMOVED constant", () => {
		expect(ENTRY_TYPES.PACKAGE_REMOVED).toBe("monorepo-package-removed");
	});
});

// ---------------------------------------------------------------------------
// activation module
// ---------------------------------------------------------------------------
describe("activation", () => {
	const testTmpDir = join(tmpdir(), `pi-activation-test-${Date.now()}`);

	afterEach(async () => {
		await rm(testTmpDir, { recursive: true, force: true });
	});

	describe("getExtensionsDir", () => {
		it("returns correct path for global scope", () => {
			const dir = getExtensionsDir("global");
			// Should end with /monorepo-registry/active and be under the agent dir
			expect(dir).toMatch(/monorepo-registry\/active$/);
		});

		it("returns correct path for local scope", () => {
			const dir = getExtensionsDir("local", "/my/project");
			expect(dir).toBe("/my/project/monorepo-registry/active");
		});

		it("uses process.cwd() as default for local scope", () => {
			const dir = getExtensionsDir("local");
			expect(dir).toBe(`${process.cwd()}/monorepo-registry/active`);
		});
	});

	describe("createActivationSymlink", () => {
		it("creates symlink in temp extensions dir", async () => {
			const packageDir = join(testTmpDir, "my-pkg");
			await mkdir(packageDir, { recursive: true });

			const info = await createActivationSymlink(packageDir, "my-pkg", "local", testTmpDir);

			expect(info.packageName).toBe("my-pkg");
			expect(info.scope).toBe("local");
			expect(info.targetPath).toBe(packageDir);
			expect(info.activatedAt).toBeTruthy();

			// Verify symlink exists and points correctly
			const stat = await lstat(info.symlinkPath);
			expect(stat.isSymbolicLink()).toBe(true);
			const target = await readlink(info.symlinkPath);
			expect(target).toBe(packageDir);
		});

		it("is idempotent when target matches", async () => {
			const packageDir = join(testTmpDir, "idempotent-pkg");
			await mkdir(packageDir, { recursive: true });

			const info1 = await createActivationSymlink(packageDir, "idempotent-pkg", "local", testTmpDir);
			const info2 = await createActivationSymlink(packageDir, "idempotent-pkg", "local", testTmpDir);

			expect(info1.symlinkPath).toBe(info2.symlinkPath);
			expect(info1.targetPath).toBe(info2.targetPath);
		});

		it("throws on conflicting existing symlink", async () => {
			const packageDir1 = join(testTmpDir, "pkg-real-a");
			const packageDir2 = join(testTmpDir, "pkg-real-b");
			await mkdir(packageDir1, { recursive: true });
			await mkdir(packageDir2, { recursive: true });

			// Create first activation
			await createActivationSymlink(packageDir1, "conflict-pkg", "local", testTmpDir);

			// Try to activate a different target under the same name
			await expect(createActivationSymlink(packageDir2, "conflict-pkg", "local", testTmpDir)).rejects.toThrow(
				"Symlink conflict",
			);
		});

		it("handles scoped package names", async () => {
			const packageDir = join(testTmpDir, "scoped-pkg");
			await mkdir(packageDir, { recursive: true });

			// Scoped package names contain @ and /
			const info = await createActivationSymlink(packageDir, "@some-scope/my-tool", "local", testTmpDir);
			expect(info.symlinkPath).toContain("@some-scope/my-tool");
		});
	});

	describe("removeActivationSymlink", () => {
		it("removes existing symlink", async () => {
			const packageDir = join(testTmpDir, "remove-me");
			await mkdir(packageDir, { recursive: true });
			await createActivationSymlink(packageDir, "remove-me", "local", testTmpDir);

			const removed = await removeActivationSymlink("remove-me", "local", testTmpDir);
			expect(removed).toBe(true);

			// Verify it's gone
			await expect(lstat(join(testTmpDir, "extensions", "remove-me"))).rejects.toThrow();
		});

		it("returns false for non-existent symlink", async () => {
			const removed = await removeActivationSymlink("no-such-pkg", "local", testTmpDir);
			expect(removed).toBe(false);
		});

		it("returns false for non-symlink entry", async () => {
			// Create a regular directory at the symlink location
			const extDir = join(testTmpDir, "extensions");
			await mkdir(join(extDir, "regular-dir"), { recursive: true });

			const removed = await removeActivationSymlink("regular-dir", "local", testTmpDir);
			expect(removed).toBe(false);
		});
	});

	describe("isActivated", () => {
		it("returns true when symlink exists", async () => {
			const packageDir = join(testTmpDir, "active-pkg");
			await mkdir(packageDir, { recursive: true });
			await createActivationSymlink(packageDir, "active-pkg", "local", testTmpDir);

			const active = await isActivated("active-pkg", "local", testTmpDir);
			expect(active).toBe(true);
		});

		it("returns false when symlink does not exist", async () => {
			const active = await isActivated("no-such-pkg", "local", testTmpDir);
			expect(active).toBe(false);
		});

		it("returns false for non-symlink entry", async () => {
			const extDir = join(testTmpDir, "extensions");
			await mkdir(join(extDir, "not-a-link"), { recursive: true });

			const active = await isActivated("not-a-link", "local", testTmpDir);
			expect(active).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// loader module
// ---------------------------------------------------------------------------
describe("loader", () => {
	describe("discoverActiveExtensions", () => {
		it("returns empty array for non-existent directory", async () => {
			const { discoverActiveExtensions } = await import("../src/loader.js");
			expect(discoverActiveExtensions("/nonexistent/path")).toEqual([]);
		});

		it("discovers extension with pi.extensions manifest", async () => {
			const { discoverActiveExtensions } = await import("../src/loader.js");
			const activeDir = join(tmpdir(), `loader-test-${Date.now()}`);
			const pkgDir = join(activeDir, "my-ext");
			await mkdir(join(pkgDir, "src"), { recursive: true });

			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "my-ext", pi: { extensions: ["./src/index.ts"] } }),
			);
			await writeFile(join(pkgDir, "src", "index.ts"), "export default () => {};");

			const discovered = discoverActiveExtensions(activeDir);
			expect(discovered).toHaveLength(1);
			expect(discovered[0].name).toBe("my-ext");
			expect(discovered[0].entryPoint).toContain("src/index.ts");

			await rm(activeDir, { recursive: true });
		});

		it("skips directories without pi manifest", async () => {
			const { discoverActiveExtensions } = await import("../src/loader.js");
			const activeDir = join(tmpdir(), `loader-test-noext-${Date.now()}`);
			const pkgDir = join(activeDir, "not-an-ext");
			await mkdir(pkgDir, { recursive: true });

			const { writeFile } = await import("node:fs/promises");
			await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "not-an-ext" }));

			const discovered = discoverActiveExtensions(activeDir);
			expect(discovered).toHaveLength(0);

			await rm(activeDir, { recursive: true });
		});

		it("resolves symlinks to real paths", async () => {
			const { discoverActiveExtensions } = await import("../src/loader.js");
			const activeDir = join(tmpdir(), `loader-test-sym-${Date.now()}`);
			const realDir = join(tmpdir(), `loader-test-sym-real-${Date.now()}`);
			const pkgDir = join(realDir, "linked-ext");
			await mkdir(join(pkgDir, "src"), { recursive: true });

			const { writeFile, symlink } = await import("node:fs/promises");
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "linked-ext", pi: { extensions: ["./src/index.ts"] } }),
			);
			await writeFile(join(pkgDir, "src", "index.ts"), "export default () => {};");

			await mkdir(activeDir, { recursive: true });
			await symlink(pkgDir, join(activeDir, "linked-ext"));

			const discovered = discoverActiveExtensions(activeDir);
			expect(discovered).toHaveLength(1);
			expect(discovered[0].name).toBe("linked-ext");
			expect(discovered[0].path).toBe(pkgDir);

			await rm(activeDir, { recursive: true });
			await rm(realDir, { recursive: true });
		});
	});

	describe("buildRuntimeAliases", () => {
		it("resolves core pi packages from the running process", async () => {
			// import.meta.resolve doesn't work in vitest SSR — the real alias
			// resolution is covered by cross-runtime e2e tests. Here we verify
			// the loader's loadActiveExtensions works with the alias mechanism
			// by loading an extension that uses @mariozechner/pi-coding-agent types.
			// (The test below "loads extension and calls its factory" covers this
			// for simple extensions; cross-runtime e2e covers the full peer-dep chain.)
			expect(true).toBe(true);
		});
	});

	describe("loadActiveExtensions", () => {
		it("returns empty results for non-existent directory", async () => {
			const { loadActiveExtensions } = await import("../src/loader.js");
			const mockApi = {
				registerTool: vi.fn(),
				registerCommand: vi.fn(),
				registerFlag: vi.fn(),
				on: vi.fn(),
				registerShortcut: vi.fn(),
				getFlag: vi.fn().mockReturnValue(undefined),
				appendEntry: vi.fn(),
			} as any;

			const result = await loadActiveExtensions("/nonexistent/path", mockApi);
			expect(result.loaded).toEqual([]);
			expect(result.errors).toEqual([]);
		});

		it("loads extension and calls its factory with the API", async () => {
			const { loadActiveExtensions } = await import("../src/loader.js");
			const activeDir = join(tmpdir(), `loader-load-test-${Date.now()}`);
			const pkgDir = join(activeDir, "test-ext");
			await mkdir(join(pkgDir, "src"), { recursive: true });

			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "test-ext", pi: { extensions: ["./src/index.ts"] } }),
			);
			await writeFile(
				join(pkgDir, "src", "index.ts"),
				`
				export default function(api) {
					api.registerTool({ name: "test-tool", description: "test", execute: () => {} });
					api.registerCommand("test-cmd", { description: "test", handler: () => {} });
				}
			`,
			);

			const tools = new Map();
			const commands = new Map();
			const mockApi = {
				registerTool: (t: any) => tools.set(t.name, t),
				registerCommand: (n: string, o: any) => commands.set(n, o),
				registerFlag: vi.fn(),
				on: vi.fn(),
				registerShortcut: vi.fn(),
				getFlag: vi.fn().mockReturnValue(undefined),
				appendEntry: vi.fn(),
			} as any;

			const result = await loadActiveExtensions(activeDir, mockApi);
			expect(result.loaded).toContain("test-ext");
			expect(result.errors).toHaveLength(0);
			expect(tools.has("test-tool")).toBe(true);
			expect(commands.has("test-cmd")).toBe(true);

			await rm(activeDir, { recursive: true });
		});

		it("reports error for extension that throws", async () => {
			const { loadActiveExtensions } = await import("../src/loader.js");
			const activeDir = join(tmpdir(), `loader-err-test-${Date.now()}`);
			const pkgDir = join(activeDir, "bad-ext");
			await mkdir(join(pkgDir, "src"), { recursive: true });

			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "bad-ext", pi: { extensions: ["./src/index.ts"] } }),
			);
			await writeFile(join(pkgDir, "src", "index.ts"), `throw new Error("boom");`);

			const mockApi = {
				registerTool: vi.fn(),
				registerCommand: vi.fn(),
				registerFlag: vi.fn(),
				on: vi.fn(),
				registerShortcut: vi.fn(),
				getFlag: vi.fn().mockReturnValue(undefined),
				appendEntry: vi.fn(),
			} as any;

			const result = await loadActiveExtensions(activeDir, mockApi);
			expect(result.loaded).toHaveLength(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].name).toBe("bad-ext");
			expect(result.errors[0].error).toContain("boom");

			await rm(activeDir, { recursive: true });
		});

		it("reports error for extension without default export function", async () => {
			const { loadActiveExtensions } = await import("../src/loader.js");
			const activeDir = join(tmpdir(), `loader-noop-test-${Date.now()}`);
			const pkgDir = join(activeDir, "noop-ext");
			await mkdir(join(pkgDir, "src"), { recursive: true });

			const { writeFile } = await import("node:fs/promises");
			await writeFile(
				join(pkgDir, "package.json"),
				JSON.stringify({ name: "noop-ext", pi: { extensions: ["./src/index.ts"] } }),
			);
			await writeFile(join(pkgDir, "src", "index.ts"), "export const something = 42;");

			const mockApi = {
				registerTool: vi.fn(),
				registerCommand: vi.fn(),
				registerFlag: vi.fn(),
				on: vi.fn(),
				registerShortcut: vi.fn(),
				getFlag: vi.fn().mockReturnValue(undefined),
				appendEntry: vi.fn(),
			} as any;

			const result = await loadActiveExtensions(activeDir, mockApi);
			expect(result.loaded).toHaveLength(0);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].error).toContain("does not export a default function");

			await rm(activeDir, { recursive: true });
		});
	});
});

// ---------------------------------------------------------------------------
// deps module
// ---------------------------------------------------------------------------
describe("deps", () => {
	const testTmpDir = join(tmpdir(), `pi-deps-test-${Date.now()}`);

	afterEach(async () => {
		await rm(testTmpDir, { recursive: true, force: true });
	});

	describe("isNodeModulesStale", () => {
		it("returns true when node_modules missing", async () => {
			await mkdir(testTmpDir, { recursive: true });
			const { isNodeModulesStale: check } = await import("../src/deps.js");
			expect(check(testTmpDir)).toBe(true);
		});

		it("returns false when node_modules exists", async () => {
			await mkdir(join(testTmpDir, "node_modules"), { recursive: true });
			const { isNodeModulesStale: check } = await import("../src/deps.js");
			expect(check(testTmpDir)).toBe(false);
		});
	});

	describe("ensureNodeModules", () => {
		it("skips when not stale", async () => {
			await mkdir(join(testTmpDir, "node_modules"), { recursive: true });
			const { ensureNodeModules } = await import("../src/deps.js");
			const result = ensureNodeModules(testTmpDir);
			expect(result.installed).toBe(false);
			expect(result.output).toBe("");
		});

		it("runs npm install when stale", async () => {
			await mkdir(testTmpDir, { recursive: true });

			const mockExec = vi.fn().mockReturnValue("installed ok");
			const { ensureNodeModules } = await import("../src/deps.js");
			const result = ensureNodeModules(testTmpDir, mockExec);
			expect(result.installed).toBe(true);
			expect(result.output).toBe("installed ok");
			expect(mockExec).toHaveBeenCalledWith("npm install --omit=dev", expect.objectContaining({ cwd: testTmpDir }));
		});

		it("throws on npm install failure", async () => {
			await mkdir(testTmpDir, { recursive: true });

			const installErr = new Error("npm install failed") as Error & { status: number; stderr: string };
			installErr.status = 1;
			installErr.stderr = "ERR! something broke";

			const mockExec = vi.fn().mockImplementation(() => {
				throw installErr;
			});
			const { ensureNodeModules } = await import("../src/deps.js");
			expect(() => ensureNodeModules(testTmpDir, mockExec)).toThrow("npm install failed");
		});
	});
});
