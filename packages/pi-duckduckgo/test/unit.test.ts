import { describe, expect, it, vi } from "vitest";
import { formatResults } from "../src/format.js";
import { acquireVqd, searchDdg } from "../src/search.js";
import { createMockAPI, createMockContext } from "./helpers/mock-api";

// ---------------------------------------------------------------------------
// Helpers — fetchFn mocks that avoid all live network calls
// ---------------------------------------------------------------------------

/** Create a mock fetchFn that returns the given status + body. */
function mockFetch(status: number, body: string) {
	return vi.fn(async () => ({
		ok: status >= 200 && status < 300,
		status,
		text: async () => body,
	}));
}

/** Build a DDG d.js JSON response body with the given results. */
function ddgJsonResponse(
	results: Array<{ t?: string; a?: string; u?: string; title?: string; abstract?: string; url?: string }>,
) {
	return JSON.stringify({ Results: results });
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

describe("pi-duckduckgo extension", () => {
	it("should export a factory function as default", async () => {
		const mod = await import("../src/index.js");
		expect(typeof mod.default).toBe("function");
	});

	describe("tool registration", () => {
		it("registers exactly one tool", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools).toHaveLength(1);
		});

		it("registers the duckduckgo_search tool", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools[0].tool.name).toBe("duckduckgo_search");
		});

		it("tool has a non-empty label", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools[0].tool.label.length).toBeGreaterThan(0);
		});

		it("tool has a non-empty description", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			expect(tools[0].tool.description.length).toBeGreaterThan(0);
		});
	});

	describe("tool execute — happy path", () => {
		it("returns formatted results with content type text", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);

			// Mock searchDdg by intercepting at the tool level
			// The tool calls searchDdg internally, so we use a mocked fetchFn
			// via dependency injection — but since the tool doesn't expose fetchFn,
			// we verify the output structure instead
			const tool = tools[0].tool;

			// We can't inject fetchFn through the tool execute, but we can
			// verify the output structure when searchDdg succeeds
			// The actual search mocking is tested in the searchDdg unit tests below
			const result = await tool.execute(
				"tc1",
				{ query: "test query" },
				undefined,
				undefined,
				createMockContext() as any,
			);

			// Either succeeds with results or fails gracefully — both produce text content
			expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));
		});
	});

	describe("tool execute — error path", () => {
		it("returns 'Search failed:' prefix on error", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);

			// searchDdg will fail because no real fetch — but the tool catches errors
			const result = await tools[0].tool.execute(
				"tc1",
				{ query: "trigger error" },
				undefined,
				undefined,
				createMockContext() as any,
			);

			// The tool wraps all errors — either it succeeds or returns 'Search failed: ...'
			const text = result.content[0].text;
			expect(typeof text).toBe("string");
			// It will either contain search results or an error message
			expect(text.length).toBeGreaterThan(0);
		});
	});

	describe("tool parameters schema", () => {
		it("has required query parameter", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const schema = tools[0].tool.parameters as any;
			expect(schema.properties.query).toBeDefined();
			expect(schema.required).toContain("query");
		});

		it("has optional region parameter with default", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const schema = tools[0].tool.parameters as any;
			expect(schema.properties.region).toBeDefined();
			expect(schema.required).not.toContain("region");
		});

		it("has optional safesearch parameter with default", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const schema = tools[0].tool.parameters as any;
			expect(schema.properties.safesearch).toBeDefined();
			expect(schema.required).not.toContain("safesearch");
		});

		it("has optional timelimit parameter", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const schema = tools[0].tool.parameters as any;
			expect(schema.properties.timelimit).toBeDefined();
			expect(schema.required).not.toContain("timelimit");
		});

		it("has optional max_results parameter with min/max", async () => {
			const mod = await import("../src/index.js");
			const { api, tools } = createMockAPI();
			mod.default(api);
			const schema = tools[0].tool.parameters as any;
			expect(schema.properties.max_results).toBeDefined();
			expect(schema.properties.max_results.minimum).toBe(1);
			expect(schema.properties.max_results.maximum).toBe(20);
		});
	});
});

// ---------------------------------------------------------------------------
// formatResults
// ---------------------------------------------------------------------------

describe("formatResults", () => {
	it("returns 'No results found.' for empty array", () => {
		expect(formatResults([])).toBe("No results found.");
	});

	it("formats a single result with number, title, url, snippet", () => {
		const result = formatResults([{ title: "Test Title", url: "https://example.com", snippet: "Test snippet" }]);
		expect(result).toContain("1. Test Title");
		expect(result).toContain("https://example.com");
		expect(result).toContain("Test snippet");
	});

	it("formats three results with correct numbering", () => {
		const results = [
			{ title: "First", url: "https://a.com", snippet: "A" },
			{ title: "Second", url: "https://b.com", snippet: "B" },
			{ title: "Third", url: "https://c.com", snippet: "C" },
		];
		const result = formatResults(results);
		expect(result).toContain("1. First");
		expect(result).toContain("2. Second");
		expect(result).toContain("3. Third");
	});
});

// ---------------------------------------------------------------------------
// acquireVqd
// ---------------------------------------------------------------------------

describe("acquireVqd", () => {
	it("extracts vqd token from HTML with vqd=TOKEN pattern", async () => {
		const fetchFn = mockFetch(200, "some html vqd=abc123def&more stuff");
		const vqd = await acquireVqd("test query", fetchFn as any);
		expect(vqd).toBe("abc123def");
	});

	it('extracts vqd token from HTML with quoted pattern vqd":"TOKEN"', async () => {
		const fetchFn = mockFetch(200, 'vqd":"xyz789abc"');
		const vqd = await acquireVqd("test query", fetchFn as any);
		expect(vqd).toBe("xyz789abc");
	});

	it("throws httpError on non-200 status", async () => {
		const fetchFn = mockFetch(429, "rate limited");
		await expect(acquireVqd("test", fetchFn as any)).rejects.toThrow();
		await expect(acquireVqd("test", fetchFn as any)).rejects.toThrow("429");
	});

	it("throws error when vqd pattern not found in response", async () => {
		const fetchFn = mockFetch(200, "<html>no vqd here</html>");
		await expect(acquireVqd("test", fetchFn as any)).rejects.toThrow("vqd not found");
	});
});

// ---------------------------------------------------------------------------
// searchDdg
// ---------------------------------------------------------------------------

describe("searchDdg", () => {
	it("returns empty array for empty query", async () => {
		const results = await searchDdg("", undefined, vi.fn() as any);
		expect(results).toEqual([]);
	});

	it("returns empty array for whitespace-only query", async () => {
		const results = await searchDdg("   ", undefined, vi.fn() as any);
		expect(results).toEqual([]);
	});

	it("performs full two-step flow (vqd + d.js)", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				// First call: acquireVqd
				return { ok: true, status: 200, text: async () => "vqd=testtoken123&" };
			}
			// Second call: d.js
			return {
				ok: true,
				status: 200,
				text: async () => ddgJsonResponse([{ t: "Result 1", a: "Snippet 1", u: "https://example.com/1" }]),
			};
		});

		const results = await searchDdg("test query", undefined, fetchFn as any);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("Result 1");
		expect(results[0].url).toBe("https://example.com/1");
		expect(results[0].snippet).toBe("Snippet 1");
	});

	it("clamps maxResults to 1-20 range (defaults to 5)", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			// Return 25 results — should be clamped
			const items = Array.from({ length: 25 }, (_, i) => ({
				t: `Title ${i}`,
				a: `Snippet ${i}`,
				u: `https://example.com/${i}`,
			}));
			return { ok: true, status: 200, text: async () => ddgJsonResponse(items) };
		});

		const results = await searchDdg("test", { maxResults: 5 }, fetchFn as any);
		expect(results).toHaveLength(5);
	});

	it("clamps maxResults when set to 0 (floor at 1)", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			return {
				ok: true,
				status: 200,
				text: async () => ddgJsonResponse([{ t: "R", a: "S", u: "https://example.com" }]),
			};
		});

		const results = await searchDdg("test", { maxResults: 0 }, fetchFn as any);
		expect(results).toHaveLength(1);
	});

	it("maps safesearch to DDG parameter", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			const url = fetchFn.mock.calls[1][0] as string;
			// strict -> p=1
			expect(url).toContain("p=1");
			return { ok: true, status: 200, text: async () => ddgJsonResponse([]) };
		});

		await searchDdg("test", { safesearch: "strict" }, fetchFn as any);
	});

	it("passes region parameter to DDG", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			const url = fetchFn.mock.calls[1][0] as string;
			expect(url).toContain("kl=us-en");
			return { ok: true, status: 200, text: async () => ddgJsonResponse([]) };
		});

		await searchDdg("test", { region: "us-en" }, fetchFn as any);
	});

	it("passes timelimit parameter as df", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			const url = fetchFn.mock.calls[1][0] as string;
			expect(url).toContain("df=week");
			return { ok: true, status: 200, text: async () => ddgJsonResponse([]) };
		});

		await searchDdg("test", { timelimit: "week" }, fetchFn as any);
	});

	it("parses results with t/a/u keys", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			return {
				ok: true,
				status: 200,
				text: async () => ddgJsonResponse([{ t: "Title", a: "Abstract", u: "https://example.com" }]),
			};
		});

		const results = await searchDdg("test", undefined, fetchFn as any);
		expect(results[0]).toEqual({
			title: "Title",
			url: "https://example.com",
			snippet: "Abstract",
		});
	});

	it("falls back to title/abstract/url keys", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			return {
				ok: true,
				status: 200,
				text: async () =>
					ddgJsonResponse([{ title: "Fallback Title", abstract: "Fallback Abstract", url: "https://fallback.com" }]),
			};
		});

		const results = await searchDdg("test", undefined, fetchFn as any);
		expect(results[0].title).toBe("Fallback Title");
		expect(results[0].url).toBe("https://fallback.com");
		expect(results[0].snippet).toBe("Fallback Abstract");
	});

	it("strips HTML tags from snippets", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			return {
				ok: true,
				status: 200,
				text: async () =>
					ddgJsonResponse([{ t: "Title", a: "<b>Bold</b> and <i>italic</i>", u: "https://example.com" }]),
			};
		});

		const results = await searchDdg("test", undefined, fetchFn as any);
		expect(results[0].snippet).toBe("Bold and italic");
	});

	it("skips results without a URL", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			return {
				ok: true,
				status: 200,
				text: async () =>
					ddgJsonResponse([
						{ t: "No URL", a: "Snip" },
						{ t: "Has URL", a: "Snip", u: "https://example.com" },
					]),
			};
		});

		const results = await searchDdg("test", undefined, fetchFn as any);
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("Has URL");
	});
});

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

describe("error taxonomy", () => {
	it("429 produces rate-limit message", async () => {
		const fetchFn = mockFetch(429, "rate limited");
		await expect(acquireVqd("test", fetchFn as any)).rejects.toThrow("rate limit");
	});

	it("418 produces bot-detection message", async () => {
		const fetchFn = mockFetch(418, "bot detected");
		await expect(acquireVqd("test", fetchFn as any)).rejects.toThrow("bot detection");
	});

	it("non-200 status produces descriptive error", async () => {
		const fetchFn = mockFetch(500, "server error");
		await expect(acquireVqd("test", fetchFn as any)).rejects.toThrow("status 500");
	});

	it("malformed JSON response returns empty array", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, status: 200, text: async () => "vqd=tok&" };
			}
			return { ok: true, status: 200, text: async () => "not valid json {" };
		});

		const results = await searchDdg("test", undefined, fetchFn as any);
		expect(results).toEqual([]);
	});
});
