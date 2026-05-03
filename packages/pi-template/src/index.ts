/**
 * pi-template — A minimal pi extension demonstrating tool, command, and event handler registration.
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TSchema } from "typebox";

/**
 * Type-safe tool definition helper. defineTool() from pi-coding-agent is a
 * type-only identity function — it just helps TypeScript infer parameter types.
 * When running under runtimes that don't export it (e.g. gsd), we provide a
 * compatible fallback.
 */
function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	return tool;
}

const helloTool = defineTool({
	name: "hello",
	label: "Hello",
	description: "Greet someone by name",
	parameters: Type.Object({
		name: Type.String({ description: "Name to greet" }),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		return {
			content: [{ type: "text" as const, text: `Hello, ${params.name}!` }],
			details: {},
		};
	},
});

export default function (pi: ExtensionAPI) {
	// Register the hello tool
	pi.registerTool(helloTool);

	// Register a /greet command
	pi.registerCommand("greet", {
		description: "Print a greeting (usage: /greet [name])",
		handler: async (args, ctx) => {
			const name = args.trim() || "world";
			ctx.ui.notify(`Hello, ${name}! 👋`, "info");
		},
	});

	// Subscribe to session_start event
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("pi-template extension loaded ✅", "info");
	});
}
