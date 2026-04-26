# @pi-extensions/pi-template

A minimal pi extension demonstrating tool, command, and event handler registration.

## What It Does

pi-template registers three things with the pi agent runtime:

- **`hello` tool** — A tool that greets someone by name. Tools are invoked by the LLM during a session when it decides the tool is relevant.
- **`/greet` command** — A slash command that prints a greeting to the UI. Commands are triggered explicitly by the user typing `/greet [name]` in the session.
- **`session_start` handler** — An event listener that fires when a session begins, notifying the user that the extension is active.

## Installation

```sh
pi install npm:@pi-extensions/pi-template
```

> **Note:** This package is published to GitHub Packages under the `@pi-extensions` scope. You need a `.npmrc` file configured with a GitHub Packages auth token to install it:
>
> ```
> @pi-extensions:registry=https://npm.pkg.github.com
> //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
> ```

## Usage

### hello tool

The `hello` tool is invoked automatically by the LLM when it decides a greeting is appropriate:

```
User: Say hello to Alice
Agent: [calls hello tool with { name: "Alice" }]
       → "Hello, Alice!"
```

### /greet command

Type directly in the pi prompt:

```
/greet Bob    → Hello, Bob! 👋
/greet        → Hello, world! 👋
```

### session_start notification

When a session begins, the extension prints:

```
pi-template extension loaded ✅
```

## Development

Clone the monorepo and install dependencies from the root:

```sh
git clone <repo-url>
cd pi-extensions
npm install
```

Available scripts in this package:

| Command | Description |
|---------|-------------|
| `npm run check` | Type-check with `tsc --noEmit` |
| `npm test` | Run all tests with Vitest |

From the monorepo root you can also run:

```sh
npm run typecheck   # type-check all packages
npm run check       # lint all files with Biome
npm run test        # run all tests
npm run check:all   # typecheck + lint + test
```

## Testing

Run tests from the root or from `packages/pi-template`:

```sh
npm test
```

The test suite has five tiers:

| Tier | File | What it verifies |
|------|------|------------------|
| Unit | `test/unit.test.ts` | Tool and command handlers in isolation |
| Integration | `test/integration.test.ts` | Factory function registers all extensions correctly |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension via `SessionManager` |
| Index | `test/index.test.ts` | Re-exports and entry point validation |

## Package Structure

```
packages/pi-template/
├── src/
│   └── index.ts        # Default export: factory function receiving ExtensionAPI
├── test/
│   ├── unit.test.ts
│   ├── integration.test.ts
│   ├── package-shape.test.ts
│   ├── sdk-e2e.test.ts
│   └── index.test.ts
└── package.json        # pi manifest under "pi.extensions" field
```

The entry point is `src/index.ts`, which exports a default function. pi loads this file via jiti (no compilation step) and calls it with an `ExtensionAPI` instance. The `"pi-package"` keyword in `package.json` tells pi this is an extension package.
