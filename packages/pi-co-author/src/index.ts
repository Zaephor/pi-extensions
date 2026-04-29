/**
 * pi-co-author — A pi extension.
 */

import { Type } from "@mariozechner/pi-ai";
import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

const piCoAuthorTool = defineTool({
	name: "pi-co-author",
	label: "Pi-co-author",
	description: "A pi extension",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
		return {
			content: [{ type: "text" as const, text: "pi-co-author executed" }],
			details: {},
		};
	},
});

export default function (pi: ExtensionAPI) {
	// Register the pi-co-author tool
	pi.registerTool(piCoAuthorTool);

	// Subscribe to session_start event
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify("pi-co-author extension loaded ✅", "info");
	});
}
