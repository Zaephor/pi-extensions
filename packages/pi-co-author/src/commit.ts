/**
 * Pure logic for git commit command detection and trailer generation.
 *
 * @module commit
 */

import type { Api, Model } from "@earendil-works/pi-ai";

// ─── Trailer options ─────────────────────────────────────────────────

export type TrailerMode = "single" | "split" | "disabled";

export interface TrailerOptions {
	/** How to format the co-author trailer. */
	mode: TrailerMode;
	/** Detected agent name (e.g. "Pi" or "GSD"). */
	agent: string;
	/** Human-readable model name. */
	modelName: string;
	/** Agent version string. */
	version?: string;
}

// ─── isGitCommit ─────────────────────────────────────────────────────

/**
 * Returns true if `cmd` is a `git commit` invocation that includes a `-m`
 * (or `--message=`) flag — i.e. a commit whose message we can safely amend
 * with trailers.
 *
 * Rejects amend commits, file-based messages (`-F`), and non-commit commands.
 */
export function isGitCommit(cmd: string): boolean {
	const trimmed = cmd.trim();

	// Must contain "git commit" — may be preceded by "cd ... &&" or similar shell prefix
	if (!/(?:^|&&\s*|;\s*|\|\|\s*)git\s+commit\b/.test(trimmed)) return false;

	// Reject --amend
	if (/--amend(?:\s|$)/.test(trimmed)) return false;

	// Reject -F / --file (message from file — we can't amend it inline)
	if (/\s-F\s/.test(trimmed) || /\s-F$/.test(trimmed) || /--file[=\s]/.test(trimmed)) return false;

	// Must contain -m or --message=
	if (/\s-m\s/.test(trimmed) || /\s-m$/.test(trimmed)) return true;
	if (/--message=/.test(trimmed)) return true;

	// -m can be part of combined short flags like -am
	if (/\s-[a-zA]*m[a-zA-Z]*\s/.test(trimmed) || /\s-[a-zA]*m[a-zA-Z]*$/.test(trimmed)) return true;

	return false;
}

// ─── appendTrailers ──────────────────────────────────────────────────

const PI_EMAIL = "noreply@pi.dev";

/**
 * Append co-author / generated-by trailers to a git commit command's message.
 *
 * Modes:
 * - `single`: `Co-Authored-By: Agent <Model> <noreply@pi.dev>`
 * - `split`:  Two trailers — one Co-Authored-By for the model, one Generated-By for the agent.
 * - `disabled`: returns `cmd` unchanged.
 */
export function appendTrailers(cmd: string, opts: TrailerOptions): string {
	if (opts.mode === "disabled") return cmd;

	const trailers = buildTrailers(opts);
	if (trailers.length === 0) return cmd;

	// Find the commit message boundary. We need to locate the -m / --message= flag
	// and insert trailers before the closing quote.
	const trailerBlock = trailers.join("\n");

	// Strategy: match the -m ... message portion and append before the closing quote.
	// Handle both -m "..." and --message="..." forms, as well as $'...' ANSI-C quoting.

	// Try --message="..." form first
	const msgEqMatch = cmd.match(/(--message=)(["'])(.*)\2/);
	if (msgEqMatch) {
		const [, prefix, quote] = msgEqMatch;
		const idx = cmd.indexOf(msgEqMatch[0]);
		const after = cmd.slice(idx + prefix.length + 1); // skip --message="
		// Find the closing quote
		const closingIdx = findClosingQuote(after, quote);
		if (closingIdx >= 0) {
			const msgBody = after.slice(0, closingIdx);
			const rest = after.slice(closingIdx + 1);
			return `${cmd.slice(0, idx) + prefix + quote + msgBody}\n\n${trailerBlock}${quote}${rest}`;
		}
	}

	// Try -m "..." or -m '...' (may be combined flags like -am)
	const mFlagMatch = cmd.match(/(?:^|\s)(-[a-zA]*m[a-zA]*)\s+(["'$])/);
	if (mFlagMatch) {
		const flagPart = mFlagMatch[1];
		// The flag portion starts at mFlagMatch.index + offset
		const flagStart = cmd.indexOf(flagPart, mFlagMatch.index);
		const afterFlag = cmd.slice(flagStart + flagPart.length).trimStart();
		const quoteChar = afterFlag[0];
		const after = afterFlag.slice(1);
		const closingIdx = findClosingQuote(after, quoteChar);
		if (closingIdx >= 0) {
			const msgBody = after.slice(0, closingIdx);
			const rest = after.slice(closingIdx + 1);
			return `${cmd.slice(0, flagStart + flagPart.length)} ${quoteChar}${msgBody}\n\n${trailerBlock}${quoteChar}${rest}`;
		}
	}

	// Fallback: can't parse message — return unchanged
	return cmd;
}

function buildTrailers(opts: TrailerOptions): string[] {
	const { mode, agent, modelName, version } = opts;

	if (mode === "single") {
		return [`Co-Authored-By: ${agent} <${modelName}> <${PI_EMAIL}>`];
	}

	if (mode === "split") {
		const lines: string[] = [`Co-Authored-By: ${modelName} <${PI_EMAIL}>`];
		const versionSuffix = version ? ` v${version}` : "";
		lines.push(`Generated-By: ${agent}${versionSuffix}`);
		return lines;
	}

	return [];
}

/**
 * Find the closing quote for a given opening quote character.
 * Handles escaped quotes within the string (e.g. \" or \').
 * Also handles $'...' ANSI-C quoting where the opening char is $.
 */
function findClosingQuote(text: string, quote: string): number {
	const target = quote === "$" ? "'" : quote;
	let escaped = false;
	let i = 0;
	for (; i < text.length; i++) {
		const ch = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === target) {
			return i;
		}
	}
	return -1;
}

// ─── detectAgent ─────────────────────────────────────────────────────

/**
 * Detect which agent is running: "Pi" or "GSD".
 *
 * Checks for the `APP_NAME` or `PI_PACKAGE_DIR` environment variables
 * set by the pi/gsd runtime to distinguish the two.
 */
export function detectAgent(): string {
	const appName = process.env.APP_NAME ?? "";
	const pkgDir = process.env.PI_PACKAGE_DIR ?? "";

	if (appName.toLowerCase().includes("gsd") || pkgDir.toLowerCase().includes("gsd")) {
		return "GSD";
	}

	return "Pi";
}

// ─── formatModelName ─────────────────────────────────────────────────

/**
 * Extract a human-readable model name from the pi Model object.
 *
 * Falls back to the model id when name is empty.
 */
export function formatModelName(model: Model<Api> | undefined): string {
	if (!model) return "unknown";
	if (model.name && model.name.length > 0) return model.name;
	if (model.id && model.id.length > 0) return model.id;
	return "unknown";
}
