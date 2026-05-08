/**
 * DDG API client — acquires vqd token and fetches results from d.js endpoint.
 * No external dependencies; uses globalThis.fetch by default.
 */

/** A single search result from DuckDuckGo. */
export interface DdgSearchResult {
	title: string;
	url: string;
	snippet: string;
}

/** Options for refining a DDG search. */
export interface DdgSearchOptions {
	region?: string;
	safesearch?: "strict" | "moderate" | "off";
	timelimit?: "day" | "week" | "month" | "year";
	maxResults?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

const HTML_HEADERS: Record<string, string> = {
	"User-Agent": USER_AGENT,
	Accept:
		"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"Accept-Language": "en-US,en;q=0.9",
};

/** Strip HTML tags (e.g. <b>highlight</b>) from DDG abstract text. */
function stripHtml(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

/** Map safesearch label to DDG numeric parameter value. */
function mapSafesearch(
	safesearch?: "strict" | "moderate" | "off",
): string | undefined {
	switch (safesearch) {
		case "strict":
			return "1";
		case "moderate":
			return "-1";
		case "off":
			return "-2";
		default:
			return undefined;
	}
}

/** Build a descriptive error when DDG returns a non-200 status. */
function httpError(
	status: number,
	context: string,
): Error & { statusCode: number } {
	const err = new Error(context) as Error & { statusCode: number };
	err.statusCode = status;

	if (status === 429) {
		err.message =
			"DDG rate limit reached (429). Try again later or use a different search provider.";
	} else if (status === 418) {
		err.message =
			"DDG bot detection triggered (418). Try a different search provider or reduce request frequency.";
	} else {
		err.message = `DDG request failed with status ${status}: ${context}`;
	}

	return err;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire the vqd token required for DDG search.
 *
 * Fetches the DDG HTML search page and extracts the vqd token from the
 * response body using a regex that matches multiple embedding patterns.
 *
 * @param query    Search query string
 * @param fetchFn  Optional fetch implementation (defaults to globalThis.fetch)
 * @returns The vqd token string
 */
export async function acquireVqd(
	query: string,
	fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

	const resp = await fetchFn(url, { headers: HTML_HEADERS });

	if (!resp.ok) {
		throw httpError(
			resp.status,
			`Failed to acquire search token for query: "${query.slice(0, 60)}"`,
		);
	}

	const body = await resp.text();

	// DDG embeds vqd in several patterns — match the most common ones.
	const match =
		/vqd=([^&"']+)|vqd['"]\s*[:=]\s*['"]([^'"]+)['"]/.exec(body);

	if (!match) {
		throw new Error(
			"Failed to acquire search token (vqd not found in DDG response). The query may be malformed or DDG may have changed its page structure.",
		);
	}

	return (match[1] ?? match[2]) as string;
}

/**
 * Perform a DuckDuckGo search and return structured results.
 *
 * 1. Acquires a vqd token from the DDG HTML endpoint.
 * 2. Queries the DDG d.js JSON endpoint with the token.
 * 3. Parses and returns an array of results.
 *
 * @param query    Search query string
 * @param options  Optional search parameters (region, safesearch, timelimit, maxResults)
 * @param fetchFn  Optional fetch implementation (defaults to globalThis.fetch)
 * @returns Array of search results
 */
export async function searchDdg(
	query: string,
	options?: DdgSearchOptions,
	fetchFn: typeof fetch = globalThis.fetch,
): Promise<DdgSearchResult[]> {
	if (!query || query.trim().length === 0) {
		return [];
	}

	const maxResults = Math.min(
		Math.max(options?.maxResults ?? 5, 1),
		20,
	);

	// Step 1: acquire vqd token
	const vqd = await acquireVqd(query, fetchFn);

	// Step 2: build d.js request
	const params = new URLSearchParams({
		q: query,
		vqd,
		kl: options?.region ?? "wt-wt",
	});

	const safeVal = mapSafesearch(options?.safesearch);
	if (safeVal) params.set("p", safeVal);

	if (options?.timelimit) params.set("df", options.timelimit);

	const url = `https://links.duckduckgo.com/d.js?${params.toString()}`;

	const resp = await fetchFn(url, { headers: HTML_HEADERS });

	if (!resp.ok) {
		throw httpError(
			resp.status,
			`Search request failed for query: "${query.slice(0, 60)}"`,
		);
	}

	// Step 3: parse response
	const body = await resp.text();
	let json: unknown;

	try {
		json = JSON.parse(body);
	} catch {
		// DDG sometimes returns non-JSON or empty bodies
		return [];
	}

	// Navigate the DDG response structure: { Results: [...] }
	const resultsArray = (json as Record<string, unknown>)?.Results;
	if (!Array.isArray(resultsArray)) {
		return [];
	}

	const out: DdgSearchResult[] = [];

	for (const item of resultsArray) {
		if (out.length >= maxResults) break;

		const rec = item as Record<string, unknown>;
		const rawUrl =
			typeof rec.u === "string"
				? rec.u
				: typeof rec.url === "string"
					? rec.url
					: "";

		if (!rawUrl) continue;

		const title =
			typeof rec.t === "string"
				? rec.t
				: typeof rec.title === "string"
					? (rec.title as string)
					: "";

		const abstract =
			typeof rec.a === "string"
				? rec.a
				: typeof rec.abstract === "string"
					? (rec.abstract as string)
					: "";

		out.push({
			title,
			url: rawUrl,
			snippet: stripHtml(abstract),
		});
	}

	return out;
}
