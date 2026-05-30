/**
 * CLI e2e test helper for pi binary testing.
 *
 * Discovers the pi binary, spawns it with extension flags, captures JSON
 * event streams, and provides assertion helpers for command routing
 * verification.
 *
 * @module shared/cli-e2e
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/**
 * A single event from the CLI JSON event stream.
 *
 * Discriminated on `type` — covers the core lifecycle events that pi/gsd emit
 * when running with `--mode json`. Additional fields are carried as a loose
 * record so callers can inspect event-specific data without exhaustive unions.
 */
export type CliEvent = {
	type:
		| "session"
		| "agent_start"
		| "turn_start"
		| "message_start"
		| "message_update"
		| "message_end"
		| "turn_end"
		| "agent_end";
	[key: string]: unknown;
};

/** Options for {@link spawnCli}. */
export type CliSpawnOptions = {
	/** Absolute or relative path to the pi/gsd binary to invoke. */
	binary: string;
	/** Absolute path to the extension directory or .ts entry file. */
	extensionPath: string;
	/** The message or slash-command string to send. */
	message: string;
	/** Maximum wall-clock time in milliseconds before killing the process. Defaults to 15 000. */
	timeout?: number;
	/** Working directory for the spawned process. Defaults to `process.cwd()`. */
	cwd?: string;
};

/** Result of a {@link spawnCli} invocation. */
export type CliSpawnResult = {
	/** Parsed JSON events from stdout. */
	events: CliEvent[];
	/** Raw stdout captured from the process. */
	stdout: string;
	/** Raw stderr captured from the process. */
	stderr: string;
	/** Process exit code — `null` when the process was killed (e.g. timeout). */
	exitCode: number | null;
	/** `true` when the process was killed because it exceeded the timeout. */
	timedOut: boolean;
};

// ---------------------------------------------------------------------------
// Binary discovery
// ---------------------------------------------------------------------------

/**
 * Resolve the `pi` binary from the nearest `node_modules/.bin/pi`.
 *
 * Walks upward from the file's own directory until it finds a
 * `node_modules/.bin/pi` entry. Returns an absolute path, or `null` when no
 * binary is found.
 */
export function discoverPiBinary(): string | null {
	const thisDir = path.dirname(pathToFileURL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));

	let dir = thisDir;
	const root = path.parse(dir).root;

	while (dir !== root) {
		const candidate = path.join(dir, "node_modules", ".bin", "pi");
		if (fs.existsSync(candidate)) {
			return path.resolve(candidate);
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

/**
 * Spawn a pi/gsd binary and capture its JSON event stream.
 *
 * The binary is invoked with `--mode json --no-session --print --extension <path> "<message>"`.
 * If the process does not exit within `timeout` ms it is killed and
 * {@link CliSpawnResult.timedOut} is set to `true`.
 */
export function spawnCli(options: CliSpawnOptions): Promise<CliSpawnResult> {
	const { binary, extensionPath, message, timeout = 15_000, cwd } = options;

	return new Promise((resolve) => {
		const args = ["--mode", "json", "--no-session", "--print", "--extension", extensionPath, message];

		const proc = spawn(binary, args, {
			cwd: cwd ?? process.cwd(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;

		const timer = setTimeout(() => {
			timedOut = true;
			proc.kill("SIGKILL");
		}, timeout);

		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf-8");
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf-8");
		});

		const finish = (code: number | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({
				events: parseEvents(stdout),
				stdout,
				stderr,
				exitCode: code,
				timedOut,
			});
		};

		proc.on("close", finish);
		proc.on("error", (err) => {
			stderr += `\nSpawn error: ${err.message}`;
			finish(null);
		});
	});
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

/**
 * Parse raw stdout into an array of {@link CliEvent} objects.
 *
 * Splits on newlines, skips blank lines, and silently ignores lines that are
 * not valid JSON (e.g. startup banners, progress indicators).
 */
export function parseEvents(rawStdout: string): CliEvent[] {
	const events: CliEvent[] = [];

	for (const line of rawStdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			if (typeof parsed.type === "string") {
				events.push(parsed as CliEvent);
			}
		} catch {
			// Not JSON — skip (startup messages, progress output, etc.)
		}
	}

	return events;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Patterns that indicate an extension failed to load. */
const LOAD_ERROR_PATTERNS = [/Failed to load extension/i, /extension load.*error/i];

/**
 * Check stderr for extension load errors.
 *
 * Returns `true` when stderr is clean (no load-error patterns), `false` when
 * an extension load error is detected.
 */
export function assertNoLoadErrors(stderr: string): boolean {
	for (const pattern of LOAD_ERROR_PATTERNS) {
		if (pattern.test(stderr)) {
			return false;
		}
	}
	return true;
}

/**
 * Assert that a slash command was handled entirely by an extension — i.e. it
 * did **not** fall through to the LLM agent.
 *
 * Throws a descriptive error when:
 * - An `agent_start` event is present in the stream (command fell through to LLM).
 * - An extension load error is detected in stderr.
 */
export function assertCommandHandled(events: CliEvent[], stderr: string): void {
	const hasLoadErrors = !assertNoLoadErrors(stderr);
	if (hasLoadErrors) {
		throw new Error(`Extension failed to load. stderr:\n${stderr.trim() || "(empty)"}`);
	}

	const agentStart = events.find((e) => e.type === "agent_start");
	if (agentStart) {
		throw new Error(
			`Command fell through to LLM — agent_start event found in stream.\n` +
				`Events: ${JSON.stringify(events.map((e) => e.type))}\n` +
				`stderr: ${stderr.trim() || "(empty)"}`,
		);
	}
}

/**
 * Create a self-contained vitest test function that verifies a slash command
 * is handled by an extension without LLM fallthrough.
 *
 * The returned function discovers the pi binary, spawns the CLI with the
 * given command, and asserts the result. If the binary is not found, the
 * test is marked as skipped.
 *
 * @param extensionPath Absolute path to the extension.
 * @param command  Slash command string (e.g. `"/greet"`).
 * @returns A vitest-compatible test function.
 */
export function createCommandHandledTest(extensionPath: string, command: string): () => Promise<void> {
	return async function (this: { skip: () => void }) {
		const binaryPath = discoverPiBinary();

		if (!binaryPath) {
			this.skip();
			return;
		}

		const result = await spawnCli({
			binary: binaryPath,
			extensionPath,
			message: command,
		});

		assertCommandHandled(result.events, result.stderr);
	};
}
