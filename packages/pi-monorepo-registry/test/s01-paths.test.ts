/**
 * S01 paths tests — verify agent-scoped monorepo directory resolution.
 *
 * Tests that all path functions resolve under ~/.<agent>/monorepo/ (not
 * ~/.<agent>/agent/monorepo-registry/), that agent isolation works, and
 * that resetRegistryBaseDir() clears the cache.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getExtensionsDir,
	getGitDir,
	getMonorepoDir,
	getRegistryBaseDir,
	getSettingsFilePath,
	getStateFilePath,
	resetRegistryBaseDir,
} from "../src/paths.js";

/** Set both possible env vars so getAgentDir() picks up our test dir regardless of APP_NAME. */
function setTestAgentDir(dir: string) {
	process.env.PI_CODING_AGENT_DIR = dir;
	process.env.GSD_CODING_AGENT_DIR = dir;
}

/** Clear both env vars. */
function clearTestAgentDir() {
	delete process.env.PI_CODING_AGENT_DIR;
	delete process.env.GSD_CODING_AGENT_DIR;
}

afterEach(() => {
	resetRegistryBaseDir();
	clearTestAgentDir();
});

describe("getMonorepoDir", () => {
	it("returns path under ~/.<agent>/ not ~/.<agent>/agent/", () => {
		setTestAgentDir(join(homedir(), ".pi", "agent"));
		const dir = getMonorepoDir();
		expect(dir).toBe(join(homedir(), ".pi", "monorepo"));
		// Must NOT contain /agent/ segment
		expect(dir).not.toContain("/agent/");
	});

	it("resolves correctly under gsd agent dir", () => {
		setTestAgentDir(join(homedir(), ".gsd", "agent"));
		const dir = getMonorepoDir();
		expect(dir).toBe(join(homedir(), ".gsd", "monorepo"));
	});

	it("uses test directory correctly", () => {
		setTestAgentDir("/tmp/test-agent/agent");
		const dir = getMonorepoDir();
		expect(dir).toBe("/tmp/test-agent/monorepo");
	});
});

describe("getExtensionsDir", () => {
	it("returns <monorepoDir>/extensions", () => {
		setTestAgentDir("/tmp/test-agent/agent");
		expect(getExtensionsDir()).toBe("/tmp/test-agent/monorepo/extensions");
	});

	it("has no scope parameter — global only", () => {
		// getExtensionsDir() takes no arguments
		setTestAgentDir("/tmp/test-agent/agent");
		const dir = getExtensionsDir();
		expect(dir).not.toContain("/active");
		expect(dir).not.toContain("/local");
	});
});

describe("getGitDir", () => {
	it("returns <monorepoDir>/git", () => {
		setTestAgentDir("/tmp/test-agent/agent");
		expect(getGitDir()).toBe("/tmp/test-agent/monorepo/git");
	});
});

describe("getStateFilePath", () => {
	it("returns <monorepoDir>/state.json", () => {
		setTestAgentDir("/tmp/test-agent/agent");
		expect(getStateFilePath()).toBe("/tmp/test-agent/monorepo/state.json");
	});
});

describe("getSettingsFilePath", () => {
	it("returns <agentDir>/settings.json", () => {
		setTestAgentDir("/tmp/test-agent/agent");
		expect(getSettingsFilePath()).toBe("/tmp/test-agent/agent/settings.json");
	});
});

describe("agent isolation", () => {
	it("paths resolve under ~/.gsd/monorepo/ when agent dir is ~/.gsd/agent/", () => {
		setTestAgentDir(join(homedir(), ".gsd", "agent"));
		const monorepoDir = getMonorepoDir();
		expect(monorepoDir).toBe(join(homedir(), ".gsd", "monorepo"));
		expect(getExtensionsDir()).toMatch(/^.*\/\.gsd\/monorepo\/extensions$/);
		expect(getGitDir()).toMatch(/^.*\/\.gsd\/monorepo\/git$/);
		expect(getStateFilePath()).toMatch(/^.*\/\.gsd\/monorepo\/state\.json$/);
	});

	it("paths never resolve under ~/.pi/ when agent dir is ~/.gsd/agent/", () => {
		setTestAgentDir(join(homedir(), ".gsd", "agent"));
		expect(getMonorepoDir()).not.toContain("/.pi/");
		expect(getExtensionsDir()).not.toContain("/.pi/");
		expect(getGitDir()).not.toContain("/.pi/");
	});

	it("paths never resolve under ~/.gsd/ when agent dir is ~/.pi/agent/", () => {
		setTestAgentDir(join(homedir(), ".pi", "agent"));
		expect(getMonorepoDir()).not.toContain("/.gsd/");
		expect(getExtensionsDir()).not.toContain("/.gsd/");
		expect(getGitDir()).not.toContain("/.gsd/");
	});
});

describe("resetRegistryBaseDir", () => {
	it("clears cache so next call re-evaluates", () => {
		setTestAgentDir("/tmp/first-agent/agent");
		const first = getMonorepoDir();
		expect(first).toBe("/tmp/first-agent/monorepo");

		// Change env var without resetting — cache should return old value
		setTestAgentDir("/tmp/second-agent/agent");
		const cached = getMonorepoDir();
		expect(cached).toBe("/tmp/first-agent/monorepo"); // still cached

		// Reset and re-read
		resetRegistryBaseDir();
		const fresh = getMonorepoDir();
		expect(fresh).toBe("/tmp/second-agent/monorepo");
	});
});

describe("getRegistryBaseDir backward compat", () => {
	it("returns the agent dir (same as getAgentDir)", () => {
		setTestAgentDir("/tmp/compat-test/agent");
		expect(getRegistryBaseDir()).toBe("/tmp/compat-test/agent");
	});
});

describe("type shape verification", () => {
	it("ActivationMode accepts valid values", () => {
		// Import types and verify they exist at compile time — this test
		// primarily validates the type exports compile correctly.
		type Mode = import("../src/types.js").ActivationMode;
		const modes: Mode[] = ["dev", "git", "tarball"];
		expect(modes).toHaveLength(3);
	});

	it("InstalledPackage has required fields", () => {
		// Verify the shape compiles — runtime check is structural.
		const pkg: import("../src/types.js").InstalledPackage = {
			name: "test-pkg",
			sourceUrl: "https://github.com/example/repo",
			activationMode: "git",
			installedAt: "2025-01-01T00:00:00Z",
			targetPath: "/path/to/pkg",
			extensionDir: "test-pkg",
		};
		expect(pkg.name).toBe("test-pkg");
		expect(pkg.activationMode).toBe("git");
	});

	it("RegistryState includes installedPackages", () => {
		const state: import("../src/types.js").RegistryState = {
			sources: [],
			installedPackages: [
				{
					name: "my-ext",
					sourceUrl: "https://github.com/example/repo",
					activationMode: "dev",
					installedAt: "2025-01-01T00:00:00Z",
					targetPath: "/path/to/ext",
					extensionDir: "my-ext",
				},
			],
		};
		expect(state.installedPackages).toHaveLength(1);
		expect(state.installedPackages[0].name).toBe("my-ext");
	});
});
