/**
 * pi-env-detect — Detects the agent's execution environment (baremetal / VM /
 * container / nested) and its spawn capabilities, then makes the agent aware of
 * them automatically.
 *
 * - Auto-injects a compact identity+capability summary into the system prompt
 *   (before_agent_start), so the agent always knows what it can spawn.
 * - Exposes a `detect_environment(scope?)` tool for on-demand depth, including
 *   the tooling allowlist (which is deliberately NOT injected).
 *
 * @module pi-env-detect
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { detect, resetCache } from "./detect.js";
import { renderInjection, renderSummary } from "./render.js";
import { realSystem } from "./system.js";
import type { Scope } from "./types.js";

const FLAG_NAME = "--env-detect";
const DEFAULT_MODE = "inject";

const Params = Type.Object({
	scope: Type.Optional(
		StringEnum(["identity", "capability", "tooling", "all"] as const, {
			description: "Which detection scope to report. Defaults to all.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	const sys = realSystem();
	// Fresh process = fresh detection. Guards against a stale module cache if the
	// extension is reloaded within one long-lived process.
	resetCache();

	pi.registerFlag(FLAG_NAME, {
		description: "Environment detection mode: inject (default), tool-only, or disabled",
		type: "string",
		default: DEFAULT_MODE,
	});

	pi.registerTool({
		name: "detect_environment",
		label: "Detect environment",
		description:
			"Report the execution environment: identity (baremetal/VM/container/nested), spawn capabilities (KVM, nested virt, container sockets, privilege), and—on request—spawn tooling on PATH.",
		promptSnippet:
			"detect_environment(scope?) — report whether you are in a container/VM/nested env and what you can launch (VMs, containers).",
		parameters: Params,
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const scope = (params.scope ?? "all") as Scope;
			const report = detect(sys, scope);
			return {
				content: [{ type: "text" as const, text: renderSummary(report) }],
				details: report,
			};
		},
	});

	pi.on("before_agent_start", (event, _ctx) => {
		const mode = pi.getFlag(FLAG_NAME);
		if (mode === "disabled" || mode === "tool-only") return;
		const report = detect(sys, "capability"); // identity+capability, no tooling
		const block = renderInjection(report);
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});

	pi.registerCommand("detect-environment", {
		description: "Print the detected execution environment summary.",
		handler: async (_args, ctx) => {
			const report = detect(sys, "all");
			ctx.ui.notify(renderSummary(report), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.notify("pi-env-detect loaded ✅", "info");
	});
}
