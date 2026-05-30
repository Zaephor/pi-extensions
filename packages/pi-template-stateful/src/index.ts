/**
 * pi-template-stateful — Minimal demonstration of state persistence via tool
 * result details.
 *
 * The pattern: when a tool runs, it stores the new state inside its returned
 * `details`. The state lives in the session history itself, so:
 *
 *   - Branching automatically branches the state.
 *   - Replaying a session reconstructs the state by walking entries.
 *   - There are no extra files, no external storage, no race conditions.
 *
 * This template implements a tiny counter. Adapt the same pattern for any
 * extension whose tool needs to remember "where it left off" — todo lists,
 * scratch pads, multi-step workflows, etc.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Counter state carried inside tool result details. */
interface CounterDetails {
	action: "increment" | "decrement" | "reset" | "get";
	count: number;
}

const CounterParams = Type.Object({
	action: StringEnum(["increment", "decrement", "reset", "get"] as const, {
		description: "Operation to perform on the counter.",
	}),
});

/**
 * Walk session entries (newest-first) and return the most recent counter
 * value, or 0 if no counter tool has run yet in this session.
 */
function reconstructCount(entries: ReadonlyArray<{ type: string; data?: unknown }>): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "tool_result") continue;
		const data = entry.data as { toolName?: string; details?: CounterDetails } | undefined;
		if (!data || data.toolName !== "counter" || !data.details) continue;
		return data.details.count;
	}
	return 0;
}

export default function (pi: ExtensionAPI) {
	// Local cache of the current value. We re-derive it from session history
	// on session_start so that resuming a session restores the right count.
	let count = 0;

	pi.registerTool({
		name: "counter",
		label: "Counter",
		description: "A persistent counter. Increment, decrement, reset, or read the current value.",
		parameters: CounterParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "increment":
					count += 1;
					break;
				case "decrement":
					count -= 1;
					break;
				case "reset":
					count = 0;
					break;
				case "get":
					// no mutation
					break;
			}

			const details: CounterDetails = { action: params.action, count };
			return {
				content: [{ type: "text" as const, text: `Counter is now ${count}.` }],
				details,
			};
		},
	});

	pi.registerCommand("counter", {
		description: "Show the current counter value.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Counter: ${count}`, "info");
		},
	});

	// On session start, walk history to restore the counter to whatever the
	// most recent tool_result said it was. This is what makes the state
	// branching-safe: the source of truth is the entries, not in-memory state.
	pi.on("session_start", async (_event, ctx) => {
		const entries = (ctx as { entries?: ReadonlyArray<{ type: string; data?: unknown }> }).entries ?? [];
		count = reconstructCount(entries);
		ctx.ui.notify(`pi-template-stateful loaded (counter at ${count})`, "info");
	});
}
