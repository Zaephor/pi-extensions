# pi-extensions

A monorepo of extensions for the [pi](https://github.com/earendil-works/pi) coding agent.

## Overview

This monorepo contains independently versioned and published pi extensions. Each package in `packages/` is a standalone extension that are consumed via git clone. Install the monorepo registry and activate individual packages:

The repo uses npm workspaces — no Turborepo, Lerna, or extra tooling. Versioning is handled by [release-please](https://github.com/googleapis/release-please) in manifest mode, which generates per-package release PRs based on [conventional commits](https://www.conventionalcommits.org/). Packages are consumed via `pi install git:github.com/Zaephor/pi-extensions`.

> The `pi install` command itself is implemented in [pi](https://github.com/earendil-works/pi) — this repo provides the extensions that pi loads after install. Tests in `packages/pi-monorepo-registry` cover what happens once the registry is loaded (discovery, install/remove/update, settings.json bridging); the install handshake is owned by pi.

## Quick Start

```sh
git clone <repo-url>
cd pi-extensions
npm install
npm run check:all
```

This runs type-checking, linting, and the full test suite across all packages. If it passes, you're ready to develop.

## Adding a New Extension

1. **Create the package directory** under `packages/`:
   ```sh
   mkdir -p packages/my-extension/src
   ```

2. **Set up `package.json`** with the required pi manifest fields:
   ```json
   {
     "name": "my-extension",
     "version": "0.1.0",
     "type": "module",
     "keywords": ["pi-package"],
     "files": ["src"],
     "main": "./src/index.ts",
     "pi": {
       "extensions": ["./src/index.ts"]
     },
     "scripts": {
       "build": "echo 'nothing to build'",
       "check": "tsc --noEmit",
       "test": "vitest run"
     },
     "peerDependencies": {
       "@mariozechner/pi-coding-agent": "*",
       "@mariozechner/pi-ai": "*",
       "@mariozechner/pi-agent-core": "*",
       "@mariozechner/pi-tui": "*",
       "typebox": "*"
     }
   }
   ```
   - The `"pi-package"` keyword is required for pi to recognize this as an extension.
   - The `"pi"."extensions"` array tells pi which files to load.
   - pi core packages are **peer dependencies** — pi bundles them at runtime and extensions must share the same instances (D002).
   - `@mariozechner/pi-*` is the canonical import scope: it's the back-compat alias the active pi runtime ([earendil-works/pi](https://github.com/earendil-works/pi), published as `@earendil-works/pi-coding-agent`) resolves at extension load. We pin `devDependencies` to the latest `@mariozechner/pi-*` release on npm for local type-checking; the running pi binary supplies the runtime instances.

3. **Create `src/index.ts`** with a default export function:
   ```ts
   import { defineTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

   export default function (pi: ExtensionAPI) {
     // Register tools, commands, and event handlers here
   }
   ```
   - Use `defineTool()` for tools, `pi.registerCommand()` for slash commands, and `pi.on()` for events.
   - Import `Type` from `@mariozechner/pi-ai` (not directly from typebox) for type-safe parameters.
   - No build step — pi loads `.ts` source directly via jiti (D001).

4. **Add to TypeScript project references** in the root `tsconfig.json` if you want type-checking from the root.

5. **Write tests** following the pi-template pattern:
   - `test/unit.test.ts` — test handlers in isolation
   - `test/integration.test.ts` — test factory registration
   - `test/package-shape.test.ts` — validate package.json manifest
   - `test/sdk-e2e.test.ts` — full pi runtime load test

6. **Update the release-please manifest** in `.release-please-manifest.json`:
   ```json
   {
     "packages/pi-template": "0.1.0",
     "packages/my-extension": "0.1.0"
   }
   ```
   And add an entry in `release-please-config.json` under `"packages"`.

7. **Commit with conventional commits** — `feat(my-extension): add initial implementation`. release-please will pick it up automatically.

## Peer Detection Pattern

Extensions in pi can detect and cooperate with other extensions through pi's event bus (`pi.events`). This is an architectural pattern for building composable, loosely-coupled extensions — there is no hard dependency between extensions at install time.

### How it works

1. **Announce capabilities**: An extension publishes an event during `session_start` to announce what it provides:
   ```ts
   pi.on("session_start", async (_event, ctx) => {
     pi.events.publish("my-extension:ready", { capabilities: ["tool-a", "tool-b"] });
   });
   ```

2. **Consume capabilities**: Another extension subscribes to those events and adapts its behavior:
   ```ts
   pi.events.subscribe("my-extension:ready", (data) => {
     if (data.capabilities.includes("tool-a")) {
       // Enable integration with my-extension
     }
   });
   ```

3. **Graceful degradation**: If the peer extension isn't installed, the event never fires and the consumer simply doesn't activate the integration. No error, no missing dependency.

### When to use peer detection

- When two extensions provide complementary features (e.g., a linter extension and a formatter extension that want to coordinate).
- When an extension wants to *optionally* enhance another extension's behavior without requiring it.
- When you need cross-extension communication without creating a hard dependency graph.

### When not to use it

- If Extension A *requires* Extension B to function, just document it as a requirement — peer detection adds complexity that isn't needed for hard dependencies.

> **Note:** This pattern is documented here as guidance for extension authors. The pi-template extension does not implement peer detection in code — it's a single-extension starting point. See D008 for the scoping decision.

## Development

### Scripts

| Command | Scope | Description |
|---------|-------|-------------|
| `npm run typecheck` | Root | Type-check all packages (`tsc --build`) |
| `npm run check` | Root | Lint all files with Biome |
| `npm run test` | Root | Run all tests with Vitest |
| `npm run check:all` | Root | typecheck + lint + test (full verification) |
| `npm run check` | Package | Type-check single package |
| `npm test` | Package | Run tests for single package |

### Pre-commit hooks

Husky runs on every commit:

- **pre-commit**: Biome format + lint on staged files
- **commit-msg**: commitlint enforcing [conventional commits](https://www.conventionalcommits.org/)

### Conventional commits

All commits must follow the conventional format:

```
feat(pi-template): add new tool
fix(pi-template): fix greeting for empty names
docs: update root README
```

release-please uses these to determine version bumps: `feat` → minor, `fix` → patch, `feat!` or `BREAKING CHANGE` → major.

## Architecture Decisions

| ID | Decision | Choice |
|----|----------|--------|
| D001 | Compilation | Ship `.ts` source; pi loads via jiti. No build step. |
| D002 | Dependencies | pi core packages as `peerDependencies` at `"*"` range. |
| D003 | Test framework | Vitest with native ESM and TypeScript. |
| D004 | Linting | Biome matching pi-mono conventions (tabs, 120 chars). |
| D005 | Versioning | release-please manifest mode — independent per package. |
| D006 | Consumption | Git-based — `pi install git:github.com/Zaephor/pi-extensions`. No npm publication. |
| D007 | Hook scope | Pre-commit: changed files only. CI: full scope. |
| D008 | Peer detection | Documented as guidance only, not implemented in pi-template code. |
| D009 | Monorepo tooling | npm workspaces with `packages/*` glob. |

The table above is the canonical decision log. The detailed deliberation for each
decision lives in the commit history (`git log --grep="D00"`) and in the
release-please-managed CHANGELOG of the affected package.
