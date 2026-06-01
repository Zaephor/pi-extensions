/**
 * Stale clone reproduction test.
 *
 * The real production scenario:
 *   1. `gsd install` clones the repo but doesn't update it on subsequent installs
 *   2. Extension runs from that stale clone
 *   3. A new version is pushed to GitHub
 *   4. `/monorego-registry update` calls resolveSourceRoot() which tries to update
 *   5. With old code: `git pull --ff-only` fails when clone has diverged → stale version
 *   6. With fix: fetch + reset works even on diverged clones → fresh version
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverPackages } from "../src/discovery.js";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
});

function mkTemp(label: string): string {
	const dir = join(tmpdir(), `stale-${label}-${Date.now()}`);
	tempDirs.push(dir);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function git(dir: string, cmd: string): string {
	return execSync(cmd, { cwd: dir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function addPkg(root: string, name: string, version: string) {
	const dir = join(root, "packages", name);
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version, pi: { extensions: ["./src/index.ts"] } }));
	writeFileSync(join(dir, "src", "index.ts"), "export default async function() {}");
}

function pkgVersion(root: string, name: string): string {
	return JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf-8")).version;
}

describe("stale clone update", () => {
	it("git pull --ff-only fails when clone diverged; fetch+reset succeeds", async () => {
		// ── SETUP ──
		const bare = mkTemp("bare");
		git(bare, "git init --bare");

		const upstream = mkTemp("upstream");
		git(upstream, `git clone "${bare}" .`);
		git(upstream, 'git config user.email "t@t.com"');
		git(upstream, 'git config user.name "T"');

		addPkg(upstream, "my-ext", "0.2.2");
		git(upstream, "git add -A");
		git(upstream, 'git commit -m "v0.2.2"');
		git(upstream, "git branch -M main");
		git(upstream, "git push -u origin main");
		git(bare, "git symbolic-ref HEAD refs/heads/main");

		// The "installed" clone (simulates what gsd install creates)
		const installed = join(tmpdir(), `stale-inst-${Date.now()}`);
		tempDirs.push(installed);
		execSync(`git clone "${bare}" "${installed}"`, { stdio: "pipe" });
		// Set identity on this clone too — it commits a local change below, and
		// CI runners have no global git identity configured.
		git(installed, 'git config user.email "t@t.com"');
		git(installed, 'git config user.name "T"');
		expect(pkgVersion(installed, "my-ext")).toBe("0.2.2");

		// ── PUSH v0.2.6 ──
		writeFileSync(
			join(upstream, "packages", "my-ext", "package.json"),
			JSON.stringify({ name: "my-ext", version: "0.2.6", pi: { extensions: ["./src/index.ts"] } }),
		);
		git(upstream, "git add -A");
		git(upstream, 'git commit -m "v0.2.6"');
		git(upstream, "git push");

		// Pull works on a clean clone (baseline)
		git(installed, "git pull --ff-only");
		expect(pkgVersion(installed, "my-ext")).toBe("0.2.6");

		// ── SIMULATE DIVERGENCE ──
		// In production, gsd's install process may leave local state (lockfiles, builds)
		writeFileSync(join(installed, "local-change.txt"), "something");
		git(installed, "git add -A");
		git(installed, 'git commit -m "local change"');

		// ── PUSH v0.2.7 ──
		writeFileSync(
			join(upstream, "packages", "my-ext", "package.json"),
			JSON.stringify({ name: "my-ext", version: "0.2.7", pi: { extensions: ["./src/index.ts"] } }),
		);
		git(upstream, "git add -A");
		git(upstream, 'git commit -m "v0.2.7"');
		git(upstream, "git push");

		// ── PROVE: git pull --ff-only FAILS ──
		let pullFailed = false;
		try {
			git(installed, "git pull --ff-only 2>/dev/null");
		} catch {
			pullFailed = true;
		}
		expect(pullFailed).toBe(true);
		expect(pkgVersion(installed, "my-ext")).toBe("0.2.6");
		console.log("[REPRO] git pull --ff-only FAILS on diverged clone, stuck at 0.2.6");

		// ── PROVE: fetch + reset WORKS ──
		git(installed, "git fetch --all --prune --force");
		git(installed, "git reset --hard origin/main");
		git(installed, "git clean -fd");
		expect(pkgVersion(installed, "my-ext")).toBe("0.2.7");
		console.log("[REPRO] fetch + reset WORKS on diverged clone -> 0.2.7");

		// discoverPackages sees the fresh version
		const pkgs = await discoverPackages(installed, "packages");
		expect(pkgs).toHaveLength(1);
		expect(pkgs[0].version).toBe("0.2.7");
	});
});
