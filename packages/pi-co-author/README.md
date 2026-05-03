# pi-co-author

Automatically appends `Co-Authored-By` and `Generated-By` trailers to git commit messages made by the pi agent.

When the agent runs `git commit -m "..."`, this extension intercepts the bash command before execution and appends attribution trailers identifying the AI model and agent. This ensures every automated commit carries proper machine-generated attribution in a format git recognizes.

## What It Does

pi-co-author registers a `tool_call` event listener that watches for bash commands containing `git commit -m "..."`. When it detects one, it rewrites the command to include co-author trailers before the closing quote:

```
git commit -m "Fix login bug"

# becomes:

git commit -m "Fix login bug

Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>"
```

The extension also registers a `session_start` handler that confirms it loaded and reports the active mode. It **does not** register any tools or slash commands — it works transparently in the background.

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/monorepo-install pi-co-author
/reload
```

> 💡 pi auto-discovers extensions from installed packages. After installation, reload your session and the extension will activate automatically.

## Usage

No action required. Once installed, pi-co-author runs automatically on every session. It intercepts `git commit` commands that use inline messages (`-m` or `--message=`) and appends the appropriate trailer.

The extension **skips** commits that use:
- `--amend` (amend commits are left untouched)
- `-F` / `--file` (file-based messages can't be amended inline)
- Any command that isn't a `git commit` invocation

## Configuration

The extension exposes a `--co-author-mode` CLI flag with three modes:

### `single` (default)

One trailer combining agent name, model, and email:

```
Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>
```

```sh
pi --co-author-mode single
```

### `split`

Separate `Co-Authored-By` and `Generated-By` trailers:

```
Co-Authored-By: Claude 4 Sonnet <noreply@pi.dev>
Generated-By: Pi
```

```sh
pi --co-author-mode split
```

### `disabled`

No trailers are appended. The extension still loads and reports its status, but all commit commands pass through unchanged.

```sh
pi --co-author-mode disabled
```

## Examples

### Single mode commit

```
git commit -m "Add user authentication

Implement JWT-based auth with refresh token rotation."

# Rewritten to:

git commit -m "Add user authentication

Implement JWT-based auth with refresh token rotation.

Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>"
```

### Split mode commit

```
git commit -m "Refactor database layer"

# Rewritten to:

git commit -m "Refactor database layer

Co-Authored-By: Claude 4 Sonnet <noreply@pi.dev>
Generated-By: Pi"
```

### Disabled mode commit

```
git commit -m "Fix typo in README"

# Unchanged — command passes through as-is
```

## Development

Clone the monorepo and install dependencies from the root:

```sh
git clone https://github.com/Zaephor/pi-extensions.git
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

Run tests from the root or from `packages/pi-co-author`:

```sh
npm test
```

The test suite has five tiers:

| Tier | File | What it verifies |
|------|------|------------------|
| Unit | `test/unit.test.ts` | `isGitCommit` detection, `appendTrailers` formatting, `detectAgent`, `formatModelName`, and `parseConfig` in isolation |
| Integration | `test/integration.test.ts` | Factory function registers `tool_call` handler, `session_start` handler, and `co-author-mode` flag correctly |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields and `pi-package` keyword |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension via jiti and mutates git commit commands in single/split/disabled modes |
| Index | `test/index.test.ts` | Re-exports and entry point validation |

## Package Structure

```
packages/pi-co-author/
├── src/
│   ├── index.ts        # Default export: registers tool_call listener and co-author-mode flag
│   ├── commit.ts       # Pure logic: git commit detection, trailer generation, agent/model resolution
│   └── config.ts       # Flag name, default mode, and config parsing
├── test/
│   ├── unit.test.ts
│   ├── integration.test.ts
│   ├── package-shape.test.ts
│   ├── sdk-e2e.test.ts
│   ├── index.test.ts
│   └── helpers/
│       └── mock-api.ts
└── package.json        # pi manifest under "pi.extensions" field
```

The entry point is `src/index.ts`, which exports a default function. pi loads this file via jiti (no compilation step) and calls it with an `ExtensionAPI` instance. The `"pi-package"` keyword in `package.json` tells pi this is an extension package.

## Credit

This extension was inspired by [bruno-garcia/pi-co-authored-by](https://github.com/bruno-garcia/pi-co-authored-by), which provides similar co-author attribution for git commits.
