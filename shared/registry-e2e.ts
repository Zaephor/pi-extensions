/**
 * Harness for pi-monorepo-registry full CLI e2e tests.
 *
 * Spawns the real `pi` binary in --print mode against a shared temp agentDir,
 * one spawn per loop step. Provides a model-free "command handled" assertion
 * (no agent_start event, no missing-API-key fallthrough) and binary/SDK
 * version-coherence helpers.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve as importMetaResolve } from "import-meta-resolve";
import { type CliEvent, discoverPiBinary, parseEvents } from "./cli-e2e.js";

export type PiStepResult = {
	events: CliEvent[];
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
};

/** Discover the pi binary, throwing (not skipping) when absent. */
export function requirePiBinary(): string {
	const bin = discoverPiBinary();
	if (!bin) {
		throw new Error(
			"pi binary not found at node_modules/.bin/pi — registry CLI e2e requires it. " +
				"Run `npm ci` so @earendil-works/pi-coding-agent is installed.",
		);
	}
	return bin;
}

export type RunPiStepOptions = {
	agentDir: string;
	message: string;
	/** Zero or more extension entry paths → repeated `--extension`. */
	extensions?: string[];
	cwd?: string;
	timeout?: number;
};

/** Spawn one `pi --print` step pinned to agentDir. */
export function runPiStep(binary: string, opts: RunPiStepOptions): Promise<PiStepResult> {
	const { agentDir, message, extensions = [], cwd, timeout = 60_000 } = opts;
	return new Promise((resolve) => {
		const args = ["--mode", "json", "--no-session", "--print", "--no-builtin-tools"];
		for (const ext of extensions) args.push("--extension", ext);
		args.push(message);

		const proc = spawn(binary, args, {
			cwd: cwd ?? process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGKILL");
		}, timeout);

		proc.stdout.on("data", (c: Buffer) => {
			stdout += c.toString("utf-8");
		});
		proc.stderr.on("data", (c: Buffer) => {
			stderr += c.toString("utf-8");
		});

		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ events: parseEvents(stdout), stdout, stderr, exitCode: code, timedOut });
		};

		proc.on("close", finish);
		proc.on("error", (err) => {
			stderr += `\nSpawn error: ${err.message}`;
			finish(null);
		});
	});
}

const NO_API_KEY = /No API key found/i;

/** Assert a slash command was handled by an extension with no LLM fallthrough. */
export function assertHandledOffline(r: PiStepResult): void {
	if (r.timedOut) {
		throw new Error(`pi step timed out.\nstderr: ${r.stderr.trim() || "(empty)"}`);
	}
	if (r.events.some((e) => e.type === "agent_start")) {
		throw new Error(
			`Command fell through to LLM (agent_start present). Events: ${JSON.stringify(r.events.map((e) => e.type))}`,
		);
	}
	if (NO_API_KEY.test(r.stdout) || NO_API_KEY.test(r.stderr)) {
		throw new Error(`Command fell through to LLM (No API key found).\nstdout: ${r.stdout.trim()}`);
	}
	if (r.exitCode !== 0) {
		throw new Error(`pi step exited ${r.exitCode}.\nstderr: ${r.stderr.trim() || "(empty)"}`);
	}
}

/** Assert a command fell through to the LLM (negative control). */
export function assertFellThrough(r: PiStepResult): void {
	if (r.timedOut) {
		throw new Error(`pi step timed out waiting for fallthrough.\nstderr: ${r.stderr.trim() || "(empty)"}`);
	}
	const fell =
		r.events.some((e) => e.type === "agent_start") || NO_API_KEY.test(r.stdout) || NO_API_KEY.test(r.stderr);
	if (!fell) {
		throw new Error(`Expected fallthrough to LLM but command looks handled.\nstdout: ${r.stdout.trim()}`);
	}
}

function nearestPackageRoot(startFile: string): string {
	let dir = dirname(startFile);
	while (!existsSync(join(dir, "package.json"))) {
		const parent = dirname(dir);
		if (parent === dir) throw new Error(`No package.json above ${startFile}`);
		dir = parent;
	}
	return dir;
}

/** Package root that provides the SDK the in-process tests import. */
export function sdkPackageRoot(): string {
	// Uses the import-meta-resolve ponyfill for ESM resolution (the package only
	// exposes an "import" condition, so createRequire().resolve would throw).
	return nearestPackageRoot(fileURLToPath(importMetaResolve("@earendil-works/pi-coding-agent", import.meta.url)));
}

/** Package root that provides the discovered `pi` binary. */
export function binaryPackageRoot(): string {
	return nearestPackageRoot(realpathSync(requirePiBinary()));
}

/** Read the version field from <root>/package.json. */
export function pkgVersionAt(root: string): string {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version as string;
}
