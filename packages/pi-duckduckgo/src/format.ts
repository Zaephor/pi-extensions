/**
 * Format DDG search results as a numbered list for LLM consumption.
 */

import type { DdgSearchResult } from "./search.js";

/**
 * Format an array of DDG search results into a human-readable numbered list.
 *
 * Each result shows title, URL, and snippet. Returns "No results found."
 * when the input array is empty.
 *
 * @param results Array of search results to format
 * @returns Formatted string ready for LLM consumption
 */
export function formatResults(results: DdgSearchResult[]): string {
	if (results.length === 0) {
		return "No results found.";
	}

	return results
		.map(
			(r, i) =>
				`${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
		)
		.join("\n\n");
}
