/**
 * Per-extension CLI e2e test for pi-template's /greet command.
 *
 * Imports the shared helper from shared/cli-e2e.ts and verifies that the
 * /greet slash command is handled entirely by the extension (no LLM
 * fallthrough) against both pi and gsd binaries.
 *
 * This is the reference example (R034) that future extensions should copy.
 *
 * Run with: npx vitest run packages/pi-template/test/cli-e2e.test.ts
 *           npm run test:cli-e2e
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
	assertCommandHandled,
	assertNoLoadErrors,
	discoverGsdBinary,
	discoverPiBinary,
	spawnCli,
} from "../../../shared/cli-e2e.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Absolute path to the extension's entry point, computed relative to this test file. */
const EXTENSION_PATH = path.resolve(__dirname, "..", "src", "index.ts");

// ---------------------------------------------------------------------------
// Binary availability — evaluated once at describe-evaluation time
// ---------------------------------------------------------------------------

const piBinary = discoverPiBinary();
const gsdBinary = discoverGsdBinary();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI e2e: pi-template /greet command", () => {
	test.skipIf(!piBinary)(
		"pi + /greet world: command handled without LLM fallthrough",
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

	test("gsd + /greet world: command handled without LLM fallthrough", async (ctx) => {
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

	test.skipIf(!piBinary)(
		"pi + /greet Alice: command handled with custom args",
		async () => {
			const result = await spawnCli({
				binary: piBinary!,
				extensionPath: EXTENSION_PATH,
				message: "/greet Alice",
				timeout: 20_000,
			});

			assertCommandHandled(result.events, result.stderr);
			expect(result.timedOut).toBe(false);
		},
		20_000,
	);
});
