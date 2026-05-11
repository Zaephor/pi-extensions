import { afterEach, describe, expect, it } from "vitest";
import { discoverPackages, isPiCompatible } from "../src/discovery.js";
import { ENTRY_TYPES, MonorepoRegistry } from "../src/registry.js";
import type { RegistryState } from "../src/types.js";
import type { FixtureMonorepo } from "./helpers/fixture";
import { cleanupFixture, createFixtureMonorepo } from "./helpers/fixture";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

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
	const emptyState: RegistryState = { sources: [], installedPackages: [] };

	it("initialises with empty state", () => {
		const registry = new MonorepoRegistry(emptyState);
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

			const registry = new MonorepoRegistry(emptyState);

			const { source, events } = await registry.addSource(fixture.rootDir, "packages");

			expect(source.packages).toHaveLength(2);
			expect(source.url).toBe(fixture.rootDir);
			expect(registry.getSources()).toHaveLength(1);
			expect(events).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: "monorepo-source-added" }),
					expect.objectContaining({ type: "monorepo-packages-discovered" }),
				]),
			);
		});

		it("throws when adding a duplicate source", async () => {
			const registry = new MonorepoRegistry(emptyState);

			// Add once — use a path that won't have packages, so discovery returns empty
			await registry.addSource("/tmp/fake-path-for-dupe-test", "packages");

			await expect(registry.addSource("/tmp/fake-path-for-dupe-test", "packages")).rejects.toThrow(
				"Source already registered",
			);
		});

		it("returns source-added event with correct data", async () => {
			const registry = new MonorepoRegistry(emptyState);

			const { events } = await registry.addSource("/tmp/entry-test", "packages");

			const addedEvent = events.find((e) => e.type === "monorepo-source-added");
			expect(addedEvent).toBeDefined();
			expect(addedEvent!.data.source).toBe("/tmp/entry-test");
			expect(addedEvent!.data.packagesRoot).toBe("packages");
		});
	});

	describe("removeSource", () => {
		it("removes a registered source and returns event", () => {
			const registry = new MonorepoRegistry({
				sources: [{ url: "https://example.com/repo", packagesRoot: "packages", packages: [], lastUpdated: "" }],
				installedPackages: [],
			});

			const event = registry.removeSource("https://example.com/repo");

			expect(registry.getSources()).toHaveLength(0);
			expect(event.type).toBe("monorepo-source-removed");
			expect(event.data.source).toBe("https://example.com/repo");
		});

		it("throws when removing a non-existent source", () => {
			const registry = new MonorepoRegistry(emptyState);

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

			const registry = new MonorepoRegistry({
				sources: [{ url: fixture.rootDir, packagesRoot: "packages", packages: [], lastUpdated: "" }],
				installedPackages: [],
			});

			const { updated, events } = await registry.updateSource(fixture.rootDir);

			expect(updated).toHaveLength(1);
			expect(updated[0].packages).toHaveLength(1);
			expect(updated[0].packages[0].name).toBe("pkg-refresh");

			const discEvent = events.find((e) => e.type === "monorepo-packages-discovered");
			expect(discEvent).toBeDefined();
		});

		it("throws for non-existent source URL", async () => {
			const registry = new MonorepoRegistry(emptyState);

			await expect(registry.updateSource("https://nope.example.com")).rejects.toThrow("Source not found");
		});
	});

	describe("getAllPackages", () => {
		it("returns packages from all sources with sourceUrl", () => {
			const registry = new MonorepoRegistry({
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
				installedPackages: [],
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
	it("registers two slash commands: /monorepo-registry and /monorepo-package", async () => {
		const mod = await import("../src/index.js");
		const { api, commands } = createMockAPI();
		await mod.default(api);
		const names = commands.map((c) => c.name);
		expect(names).toContain("monorepo-registry");
		expect(names).toContain("monorepo-package");
		expect(commands).toHaveLength(2);
	});

	it("registers session_start event handler", async () => {
		const mod = await import("../src/index.js");
		const { api, events } = createMockAPI();
		await mod.default(api);
		expect(events.some((e) => e.event === "session_start")).toBe(true);
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

	describe("/monorepo-registry list", () => {
		it("shows message when no sources registered", async () => {
			const mod = await import("../src/index.js");
			const { api, commands } = createMockAPI();
			await mod.default(api);

			const notified: string[] = [];
			const ctx = createMockContext({ notify: (msg: string) => notified.push(msg) });
			const regCmd = commands.find((c) => c.name === "monorepo-registry")!;
			await regCmd.handler("list", ctx as any);

			expect(notified[0]).toContain("No monorepo sources registered");
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
// ENTRY_TYPES — registry event type constants
// ---------------------------------------------------------------------------
describe("ENTRY_TYPES", () => {
	it("includes SOURCE_ADDED constant", () => {
		expect(ENTRY_TYPES.SOURCE_ADDED).toBe("monorepo-source-added");
	});

	it("includes SOURCE_REMOVED constant", () => {
		expect(ENTRY_TYPES.SOURCE_REMOVED).toBe("monorepo-source-removed");
	});

	it("includes PACKAGES_DISCOVERED constant", () => {
		expect(ENTRY_TYPES.PACKAGES_DISCOVERED).toBe("monorepo-packages-discovered");
	});
});
