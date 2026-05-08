/**
 * pi-duckduckgo — DuckDuckGo search tool for pi/gsd.
 *
 * Registers the `duckduckgo_search` tool with zero configuration required.
 * No API keys — uses DDG's internal API (vqd token + d.js endpoint).
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TSchema } from "typebox";
import { formatResults } from "./format.js";
import { searchDdg } from "./search.js";

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

const duckduckgoSearch = defineTool({
	name: "duckduckgo_search",
	label: "DuckDuckGo Search",
	description: "Search DuckDuckGo and return results with titles, URLs, and snippets. No API key required.",
	promptSnippet: "Search the web with DuckDuckGo",
	promptGuidelines: [
		"Use for general web searches when you need current information",
		"Returns titles, URLs, and text snippets from search results",
	],

	parameters: Type.Object({
		query: Type.String({
			description: "Search query string",
		}),
		region: Type.Optional(
			Type.String({
				description: 'Region code (default "wt-wt" for worldwide). Examples: "us-en", "uk-en", "de-de"',
				default: "wt-wt",
			}),
		),
		safesearch: Type.Optional(
			Type.String({
				description: 'Safe search level: "strict", "moderate" (default), or "off"',
				default: "moderate",
			}),
		),
		timelimit: Type.Optional(
			Type.String({
				description: 'Limit results by time: "day", "week", "month", or "year"',
			}),
		),
		max_results: Type.Optional(
			Type.Number({
				description: "Maximum number of results to return (1–20, default 5)",
				minimum: 1,
				maximum: 20,
				default: 5,
			}),
		),
	}),

	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		try {
			const results = await searchDdg(params.query, {
				region: params.region,
				safesearch: params.safesearch as "strict" | "moderate" | "off" | undefined,
				timelimit: params.timelimit as "day" | "week" | "month" | "year" | undefined,
				maxResults: params.max_results,
			});

			const text = formatResults(results);

			return {
				content: [{ type: "text" as const, text }],
				details: { resultCount: results.length },
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : "An unexpected error occurred while searching DuckDuckGo.";
			return {
				content: [{ type: "text" as const, text: `Search failed: ${message}` }],
				details: { error: true },
			};
		}
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(duckduckgoSearch);
}
