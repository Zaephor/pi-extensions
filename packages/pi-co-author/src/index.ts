/**
 * pi-co-author — Automatically appends co-author trailers to git commit messages.
 *
 * Intercepts bash tool calls, detects `git commit -m "..."` commands, and
 * appends `Co-Authored-By` / `Generated-By` trailers based on the current
 * model and agent identity.
 *
 * Configuration is exposed via the `--co-author-mode` CLI flag:
 * - `single`  (default): One `Co-Authored-By: Agent <Model> <noreply@pi.dev>` trailer.
 * - `split`:            Separate `Co-Authored-By` and `Generated-By` trailers.
 * - `disabled`:         No trailers appended.
 *
 * @module pi-co-author
 */

import type { BashToolCallEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { appendTrailers, detectAgent, formatModelName, isGitCommit } from "./commit.js";
import { DEFAULT_MODE, FLAG_NAME, parseConfig } from "./config.js";

export default function (pi: ExtensionAPI) {
	// Register the co-author-mode flag so users can override via CLI.
	pi.registerFlag(FLAG_NAME, {
		description: "Co-author trailer mode: single, split, or disabled",
		type: "string",
		default: DEFAULT_MODE,
	});

	// Listen for tool calls and rewrite git commit commands.
	pi.on("tool_call", (event, ctx) => {
		// Only interested in bash tool calls.
		if (event.toolName !== "bash") return;

		const bashEvent = event as BashToolCallEvent;
		const command = bashEvent.input.command;

		// Only rewrite git commit commands with inline messages.
		if (!isGitCommit(command)) return;

		// Read config from the registered flag.
		const config = parseConfig(pi.getFlag(FLAG_NAME));

		// If disabled, leave the command untouched.
		if (config.mode === "disabled") return;

		// Resolve model name and agent identity.
		const modelName = formatModelName(ctx.model);
		const agent = detectAgent();

		// Append trailers in place.
		bashEvent.input.command = appendTrailers(command, {
			mode: config.mode,
			agent,
			modelName,
		});
	});

	// Notify the user that the extension is active.
	pi.on("session_start", (_event, ctx) => {
		const config = parseConfig(pi.getFlag(FLAG_NAME));
		const label = config.mode === "disabled" ? "disabled" : config.mode;
		ctx.ui.notify(`pi-co-author extension loaded (${label} mode) ✅`, "info");
	});
}
