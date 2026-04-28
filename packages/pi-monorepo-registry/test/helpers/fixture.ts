/**
 * Fixture builder for tests — creates temporary monorepo directory structures
 * on the real filesystem, then cleans up after tests.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixturePackage {
	name: string;
	version?: string;
	description?: string;
	keywords?: string[];
	piExtensions?: string[];
}

export interface FixtureMonorepo {
	/** Absolute path to the monorepo root. */
	rootDir: string;
	/** Absolute path to the packages directory. */
	packagesDir: string;
}

/**
 * Create a temporary monorepo fixture with the given packages.
 *
 * @param id - Unique identifier for this fixture (used in temp dir name).
 * @param packages - Array of package specs to create.
 * @param packagesRoot - Subdirectory name for packages (default: "packages").
 * @returns Fixture paths for use in tests.
 */
export async function createFixtureMonorepo(
	id: string,
	packages: FixturePackage[],
	packagesRoot = "packages",
): Promise<FixtureMonorepo> {
	const rootDir = join(tmpdir(), `pi-monorepo-test-${id}-${Date.now()}`);
	const packagesDir = join(rootDir, packagesRoot);

	await mkdir(packagesDir, { recursive: true });

	for (const pkg of packages) {
		// Use last segment of scoped names as directory name (@scope/foo → foo)
		const dirName = pkg.name.startsWith("@") ? pkg.name.split("/").pop()! : pkg.name;
		const pkgDir = join(packagesDir, dirName);
		await mkdir(pkgDir, { recursive: true });

		const pkgJson: Record<string, unknown> = {
			name: pkg.name,
			description: pkg.description ?? "",
		};

		if (pkg.version !== undefined) {
			pkgJson.version = pkg.version;
		}

		if (pkg.keywords) {
			pkgJson.keywords = pkg.keywords;
		}

		if (pkg.piExtensions) {
			pkgJson.pi = { extensions: pkg.piExtensions };
		}

		await writeFile(join(pkgDir, "package.json"), JSON.stringify(pkgJson, null, "\t"));
	}

	return { rootDir, packagesDir };
}

/**
 * Remove a fixture monorepo created by createFixtureMonorepo.
 */
export async function cleanupFixture(fixture: FixtureMonorepo): Promise<void> {
	await rm(fixture.rootDir, { recursive: true, force: true });
}
