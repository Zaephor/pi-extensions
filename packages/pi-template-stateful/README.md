# pi-template-stateful

A minimal pi extension demonstrating **state persistence via tool result details** — the canonical pi pattern for "remember what happened" without external storage.

This is a starter template. Copy it as the basis for any extension whose tools need to recall past actions (todo lists, scratch pads, multi-step workflows, etc.).

## What it does

- Registers a `counter` tool with four actions: `increment`, `decrement`, `reset`, `get`.
- Registers a `/counter` slash command that prints the current value.
- Registers a `session_start` handler that reconstructs the current value by walking session history.

The current count lives **inside each tool result's `details` field**. Pi stores those entries as part of the session, so when you branch, replay, or resume a session, the state automatically follows.

## Pattern

```ts
return {
    content: [{ type: "text", text: `Counter is now ${count}.` }],
    details: { action: params.action, count },  // ← state lives here
};
```

On `session_start`, walk `ctx.entries` newest-first, find the most recent `tool_result` for your tool, and pull the state out of `details`. That's the entire pattern.

## Why this pattern

| Alternative | Problem |
|---|---|
| In-memory only | Lost on restart, doesn't follow branches |
| External JSON file | Race conditions, branches diverge, no isolation between sessions |
| Tool result `details` | Inherits all pi guarantees: persistence, branching, replay, isolation |

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/monorepo-package install pi-template-stateful --dev <path-to-this-package>
/reload
```

## Files to adapt when forking

- `src/index.ts` — replace the counter with your actual tool/state shape.
- `package.json` — `name`, `version`, description; keep the `pi-package` keyword and the `pi.extensions` array.
- `test/` — adapt the unit, integration, package-shape, and sdk-e2e tests to your tool's contract.

## Development

```sh
npm test         # vitest
npm run check    # tsc --noEmit
```
