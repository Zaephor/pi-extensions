/**
 * pi-template-hook — Minimal demonstration of the tool_call interception
 * pattern.
 *
 * The pattern: subscribe to `tool_call` events, inspect or mutate the
 * tool's input *before* it executes, and optionally publish a structured
 * audit entry to the session. This is how guardrails, redactors, command
 * loggers, and policy enforcement are typically implemented in pi.
 *
 * This template implements a tiny bash audit logger:
 *
 *   - On every bash tool_call, append a session entry with a redacted
 *     summary of the command.
 *   - Optionally rewrite the command to strip a configurable redaction
 *     pattern (defaults to `--token=<value>` and `AWS_SECRET=<value>`).
 *
 * Adapt the same pattern for any cross-cutting concern: secret scrubbing,
 * confirmation prompts, command prefixing, time tracking, etc.
 */

import type { BashToolCallEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A single redaction rule: substring or regex; replacement text. */
interface RedactionRule {
	match: RegExp;
	replacement: string;
}

/**
 * Default redactions for common secret patterns. Adapt or replace when
 * forking this template. Patterns are tried in order; first match wins
 * per occurrence (global flag, so all occurrences are replaced).
 */
const DEFAULT_REDACTIONS: RedactionRule[] = [
	{ match: /--token=\S+/g, replacement: "--token=<redacted>" },
	{ match: /--api-key[= ]\S+/g, replacement: "--api-key=<redacted>" },
	{ match: /\bAWS_SECRET[A-Z_]*=\S+/g, replacement: "AWS_SECRET=<redacted>" },
	{ match: /\bGH_TOKEN=\S+/g, replacement: "GH_TOKEN=<redacted>" },
];

/**
 * Apply every redaction rule to a command string. Returns the rewritten
 * command and whether any rule matched.
 */
export function redact(
	command: string,
	rules: RedactionRule[] = DEFAULT_REDACTIONS,
): { command: string; changed: boolean } {
	let out = command;
	let changed = false;
	for (const rule of rules) {
		const next = out.replace(rule.match, rule.replacement);
		if (next !== out) {
			changed = true;
			out = next;
		}
	}
	return { command: out, changed };
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event, _ctx) => {
		// Only intercept bash tool calls. Other tools pass through untouched.
		if (event.toolName !== "bash") return;
		const bashEvent = event as BashToolCallEvent;

		const original = bashEvent.input.command;
		const { command: redacted, changed } = redact(original);

		// Mutate the command in place if a secret was found. The tool will
		// execute the redacted version, not the original.
		if (changed) {
			bashEvent.input.command = redacted;
		}

		// Always publish an audit entry so the session history records what
		// the agent attempted to run (with secrets stripped). Custom entry
		// types are visible to other extensions via the event bus.
		pi.appendEntry("hook:bash-audit", {
			command: redacted,
			redacted: changed,
			timestamp: new Date().toISOString(),
		});
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("pi-template-hook loaded (bash audit + secret redaction active)", "info");
	});
}
