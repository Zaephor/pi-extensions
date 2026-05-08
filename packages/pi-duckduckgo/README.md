# pi-duckduckgo

A pi extension that adds a DuckDuckGo search tool to the pi/gsd agent. No API key is required — the extension uses DuckDuckGo's internal API directly.

## Installation

Add `pi-duckduckgo` to your pi workspace. The extension is auto-discovered via the `pi-package` keyword in package.json.

```bash
npm install pi-duckduckgo
```

## Usage

Once installed, the `duckduckgo_search` tool is automatically registered and available in the agent's tool list.

### Tool: `duckduckgo_search`

Search DuckDuckGo and return structured results with titles, URLs, and snippets.

**Parameters:**

| Parameter  | Type   | Required | Default | Description                                      |
|------------|--------|----------|---------|--------------------------------------------------|
| `query`    | string | Yes      | —       | The search query                                 |
| `maxResults` | number | No      | 10      | Maximum number of results to return (1–50)       |
| `region`   | string | No       | "us-en" | Region code (e.g., "us-en", "uk-en", "de-de")   |
| `safeSearch` | boolean | No      | true    | Enable safe search filtering                     |

**Zero configuration:** No API keys or environment variables are needed. The extension handles DDG's vqd token retrieval and d.js endpoint parsing internally.

### Example

```json
{
  "tool": "duckduckgo_search",
  "args": {
    "query": "TypeScript best practices 2024",
    "maxResults": 5
  }
}
```

Returns an array of results:

```json
[
  {
    "title": "TypeScript Best Practices — A Guide",
    "url": "https://example.com/typescript-best-practices",
    "snippet": "A comprehensive guide to writing clean, maintainable TypeScript code..."
  }
]
```

## Error Handling

The tool returns structured error objects for common DDG failures:

- **Rate limiting (429):** Returns a message suggesting to wait and retry.
- **Bot detection (418):** Returns a message noting DDG may be blocking automated requests.
- **Network errors:** Returns the underlying error details.
- **Empty results:** Returns a message noting no results were found with suggestions to refine the query.

## Development

```bash
# Type-check
npm run check

# Run tests
npm run test
```

## Architecture

The extension implements DDG's internal API directly in TypeScript (~200–300 lines) with no external dependencies:

1. Fetches a `vqd` token from DDG's HTML search page
2. Queries DDG's `d.js` endpoint with the vqd token
3. Parses the JSON response into structured search results
