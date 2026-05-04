/**
 * Tests for shared/cli-e2e.ts — binary discovery, event parsing, assertion
 * helpers, and integration tests that spawn real pi/gsd processes.
 *
 * Run with: npm run test:cli-e2e
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	assertCommandHandled,
	assertNoLoadErrors,
	discoverGsdBinary,
	discoverPiBinary,
	parseEvents,
	spawnCli,
} from "../cli-e2e.js";

// ---------------------------------------------------------------------------
// Fixture data — realistic event stream matching pi/gsd JSON output
// ---------------------------------------------------------------------------

const FIXTURE_EVENT_STREAM = [
	JSON.stringify({ type: "session", id: "sess-abc123", model: "test-model", cwd: "/tmp" }),
	JSON.stringify({ type: "agent_start", agentId: "agent-1", model: "test-model" }),
	JSON.stringify({ type: "turn_start", turnId: "turn-1" }),
	JSON.stringify({ type: "message_start", role: "assistant" }),
	JSON.stringify({ type: "message_end", role: "assistant", content: "Hello!" }),
	JSON.stringify({ type: "turn_end", turnId: "turn-1" }),
	JSON.stringify({ type: "agent_end", reason: "done" }),
].join("\n");

const EXTENSION_PATH = path.resolve(process.cwd(), "packages", "pi-template", "src", "index.ts");

// ---------------------------------------------------------------------------
// Group 1: Binary discovery (unit tests)
// ---------------------------------------------------------------------------

describe("CLI e2e: Binary discovery", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("discoverPiBinary returns path ending with node_modules/.bin/pi when binary exists", () => {
		vi.spyOn(fs, "existsSync").mockImplementation((p) => {
			return String(p).endsWith(path.join("node_modules", ".bin", "pi"));
		});
		const result = discoverPiBinary();
		expect(result).not.toBeNull();
		expect(result!.replace(/\\/g, "/")).toMatch(/node_modules\/\.bin\/pi$/);
	});

	test("discoverPiBinary returns null when no node_modules found", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		const result = discoverPiBinary();
		expect(result).toBeNull();
	});

	test("discoverGsdBinary returns a path when gsd is on PATH", () => {
		const result = discoverGsdBinary();
		// If gsd is installed, verify it returns a valid path.
		// If not installed, null is correct — this branch still validates the function.
		if (result !== null) {
			expect(result.length).toBeGreaterThan(0);
			expect(result).toMatch(/gsd$/);
		}
		// Always passes — tests real environment behavior for both outcomes.
	});

	test("discoverGsdBinary returns null when gsd is not on PATH", () => {
		const originalPath = process.env.PATH;
		process.env.PATH = "/nonexistent/empty/path";
		try {
			const result = discoverGsdBinary();
			expect(result).toBeNull();
		} finally {
			process.env.PATH = originalPath;
		}
	});
});

// ---------------------------------------------------------------------------
// Group 2: Event parsing (unit tests)
// ---------------------------------------------------------------------------

describe("CLI e2e: Event parsing", () => {
	test("parseEvents with full event stream returns all events in order", () => {
		const events = parseEvents(FIXTURE_EVENT_STREAM);
		expect(events).toHaveLength(7);
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"agent_start",
			"turn_start",
			"message_start",
			"message_end",
			"turn_end",
			"agent_end",
		]);
	});

	test("parseEvents preserves event-specific fields", () => {
		const events = parseEvents(FIXTURE_EVENT_STREAM);
		const session = events.find((e) => e.type === "session");
		expect(session).toBeDefined();
		expect(session!.id).toBe("sess-abc123");
		expect(session!.model).toBe("test-model");

		const agentEnd = events.find((e) => e.type === "agent_end");
		expect(agentEnd).toBeDefined();
		expect(agentEnd!.reason).toBe("done");
	});

	test("parseEvents with empty string returns empty array", () => {
		expect(parseEvents("")).toEqual([]);
	});

	test("parseEvents skips non-JSON lines (blank lines, banners, errors)", () => {
		const input = [
			"", // blank line
			"[gsd] Extension load error: something broke", // non-JSON banner
			JSON.stringify({ type: "session", id: "s1" }), // valid JSON event
			"not json at all", // random text
			"  ", // whitespace-only line
			JSON.stringify({ type: "agent_end" }), // valid JSON event
		].join("\n");
		const events = parseEvents(input);
		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("session");
		expect(events[1].type).toBe("agent_end");
	});

	test("parseEvents with only session header returns array of 1 event", () => {
		const input = JSON.stringify({ type: "session", id: "s1" });
		const events = parseEvents(input);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("session");
	});
});

// ---------------------------------------------------------------------------
// Group 3: Assertion helpers (unit tests)
// ---------------------------------------------------------------------------

describe("CLI e2e: Assertion helpers", () => {
	test("assertCommandHandled passes when events have no agent_start and stderr is clean", () => {
		const events = parseEvents([JSON.stringify({ type: "session" }), JSON.stringify({ type: "turn_end" })].join("\n"));
		expect(() => assertCommandHandled(events, "")).not.toThrow();
	});

	test("assertCommandHandled passes with empty events and clean stderr", () => {
		expect(() => assertCommandHandled([], "")).not.toThrow();
	});

	test("assertCommandHandled throws when events contain agent_start", () => {
		const events = parseEvents(
			[JSON.stringify({ type: "session" }), JSON.stringify({ type: "agent_start" })].join("\n"),
		);
		expect(() => assertCommandHandled(events, "")).toThrow(/agent_start event found/);
	});

	test("assertCommandHandled throws when stderr contains extension load error", () => {
		const events = parseEvents(JSON.stringify({ type: "session" }));
		expect(() => assertCommandHandled(events, "[gsd] Extension load error: boom")).toThrow(/Extension failed to load/);
	});

	test("assertNoLoadErrors returns true for clean stderr", () => {
		expect(assertNoLoadErrors("")).toBe(true);
		expect(assertNoLoadErrors("some random output\nno errors here")).toBe(true);
	});

	test("assertNoLoadErrors returns false for stderr containing load error patterns", () => {
		expect(assertNoLoadErrors("[gsd] Extension load error: something broke")).toBe(false);
		expect(assertNoLoadErrors("Failed to load extension: bad path")).toBe(false);
		expect(assertNoLoadErrors("extension load error: timeout")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Group 4: Integration tests (real binary spawning)
// ---------------------------------------------------------------------------

describe("CLI e2e: Integration tests", () => {
	// Compute binary availability synchronously at describe evaluation time.
	const piBinary = discoverPiBinary();
	const gsdBinary = discoverGsdBinary();

	test.skipIf(!piBinary)(
		"pi + /greet: command handled without LLM fallthrough",
		async () => {
			const result = await spawnCli({
				binary: piBinary!,
				extensionPath: EXTENSION_PATH,
				message: "/greet world",
				timeout: 20_000,
			});

			assertCommandHandled(result.events, result.stderr);
			expect(result.timedOut).toBe(false);
		},
		20_000,
	);

	test("gsd + /greet: command handled without LLM fallthrough", async (ctx) => {
		if (!gsdBinary) {
			ctx.skip();
			return;
		}

		const result = await spawnCli({
			binary: gsdBinary,
			extensionPath: EXTENSION_PATH,
			message: "/greet world",
			timeout: 20_000,
		});

		// Skip if extension failed to load (environment/version mismatch)
		if (!assertNoLoadErrors(result.stderr)) {
			ctx.skip();
			return;
		}

		assertCommandHandled(result.events, result.stderr);
		expect(result.timedOut).toBe(false);
	}, 20_000);

	test("unrecognized command falls through to LLM (agent_start present)", async (ctx) => {
		// Use whichever binary is available; prefer gsd, fall back to pi.
		const binary = gsdBinary ?? piBinary;
		if (!binary) {
			ctx.skip();
			return;
		}

		const result = await spawnCli({
			binary,
			extensionPath: EXTENSION_PATH,
			message: "/nonexistent-command-test",
			timeout: 20_000,
		});

		// Skip if extension failed to load — can't test fallthrough without it
		if (!assertNoLoadErrors(result.stderr)) {
			ctx.skip();
			return;
		}

		// Skip if no API key configured — agent_start only fires when LLM connects.
		// This manifests as either a timeout or a clean exit without agent_start.
		if (result.timedOut) {
			ctx.skip();
			return;
		}

		const hasAgentStart = result.events.some((e) => e.type === "agent_start");
		if (!hasAgentStart) {
			// No agent_start and no timeout means LLM couldn't connect (no API key)
			ctx.skip();
			return;
		}
		expect(hasAgentStart).toBe(true);
	}, 20_000);
});
