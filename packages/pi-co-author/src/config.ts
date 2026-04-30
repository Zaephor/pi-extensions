/**
 * Configuration parsing for pi-co-author extension.
 *
 * Extensions receive configuration through pi's flag system:
 * - Registered via `pi.registerFlag()` with a default value
 * - Read at runtime via `pi.getFlag()`
 * - Overridable via CLI flag (e.g. `--co-author-mode split`)
 *
 * @module config
 */

import type { TrailerMode } from "./commit.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ExtensionConfig {
	/** How to format the co-author trailer. */
	mode: TrailerMode;
}

// ─── Constants ───────────────────────────────────────────────────────

/** Valid trailer mode values (lowercase). */
const VALID_MODES: readonly string[] = ["single", "split", "disabled"];

/** Default mode when no config is provided. */
export const DEFAULT_MODE: TrailerMode = "single";

/** The flag name registered with pi's extension API. */
export const FLAG_NAME = "co-author-mode";

// ─── parseConfig ─────────────────────────────────────────────────────

/**
 * Validate and normalise raw config input into an `ExtensionConfig`.
 *
 * Accepts:
 * - A string like "single", "split", or "disabled"
 * - An object with a `mode` string field
 * - `undefined` / `null` → returns default
 *
 * Throws if the mode value is not one of the valid options.
 */
export function parseConfig(raw: unknown): ExtensionConfig {
	if (raw === undefined || raw === null) {
		return { mode: DEFAULT_MODE };
	}

	// Object form: { mode: "single" }
	if (typeof raw === "object" && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		return { mode: normaliseMode(obj.mode) };
	}

	// Plain string
	if (typeof raw === "string") {
		return { mode: normaliseMode(raw) };
	}

	// Fallback to default for unrecognised types
	return { mode: DEFAULT_MODE };
}

/**
 * Normalise a mode value to a valid TrailerMode.
 * Case-insensitive; falls back to DEFAULT_MODE on invalid input.
 */
function normaliseMode(value: unknown): TrailerMode {
	if (typeof value !== "string") return DEFAULT_MODE;

	const lower = value.toLowerCase().trim();
	if (VALID_MODES.includes(lower)) {
		return lower as TrailerMode;
	}

	return DEFAULT_MODE;
}
