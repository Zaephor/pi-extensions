# Contributing to pi-extensions

Thanks for contributing. This guide covers everything you need to develop extensions in this monorepo — whether you're a human or an AI agent.

## Repository Structure

```
pi-extensions/
├── packages/                    # Each extension is an isolated package
│   ├── pi-template/             # Starting point / reference extension
│   └── pi-monorepo-registry/    # Monorepo package discovery & management
├── scripts/                     # Scaffolding and build tooling
│   └── create-extension.js      # npm run create-extension <name>
├── shared/                      # Shared TypeScript config
├── .github/workflows/
│   ├── ci.yml                   # Dynamic per-package test matrix
│   └── release.yml              # release-please auto-versioning
└── vitest.config.ts             # Shared test config
```

## Adding a New Extension

Use the scaffold script — it generates the full package structure with tests:

```sh
npm run create-extension my-extension
```

This creates `packages/my-extension/` with:
- `src/index.ts` — factory function entry point
- `test/unit.test.ts`, `test/integration.test.ts`, `test/package-shape.test.ts`, `test/sdk-e2e.test.ts`
- `package.json` with required pi manifest fields
- A package README stub

After scaffolding, you must also:

1. **Add to `tsconfig.json`** — add a project reference:
   ```json
   { "path": "packages/my-extension" }
   ```

2. **Add to `release-please-config.json`** — add under `"packages"`:
   ```json
   "packages/my-extension": { "release-type": "node", "changelog-type": "default" }
   ```

3. **Add to `.release-please-manifest.json`**:
   ```json
   "packages/my-extension": "0.1.0"
   ```

4. **Commit** using conventional commits: `feat(my-extension): add initial implementation`

Everything else — CI test matrix, release pipeline, pre-commit hooks — picks up new packages automatically from the `packages/` directory.

## Extension Anatomy

Every extension must have:

| File | Purpose |
|------|---------|
| `src/index.ts` | Default-exported factory function. pi loads this via jiti (no build step). |
| `package.json` | Must include `"keywords": ["pi-package"]` and `"pi": { "extensions": ["./src/index.ts"] }`. |
| `test/` | At minimum: `unit.test.ts` and `integration.test.ts`. |

### Entry Point

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Register tools, commands, and event handlers
}
```

### Peer Dependencies

pi core packages are **peer dependencies**, not regular dependencies:

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-agent-core": "*",
    "@mariozechner/pi-tui": "*",
    "typebox": "*"
  }
}
```

The `"*"` range is intentional — pi bundles these at runtime and extensions must share the same instances.

### Test Tiers

Follow the pi-template pattern:

| Tier | File | Purpose |
|------|------|---------|
| Unit | `test/unit.test.ts` | Handlers in isolation, no pi runtime |
| Integration | `test/integration.test.ts` | Factory registers all extensions correctly |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension |
| Index | `test/index.test.ts` | Re-exports and entry point validation |

## Commands

| Command | Scope | Description |
|---------|-------|-------------|
| `npm run typecheck` | Root | Type-check all packages (`tsc --build`) |
| `npm run check` | Root | Lint with Biome |
| `npm run test` | Root | Run all tests |
| `npm run check:all` | Root | typecheck + lint + test |
| `npm run create-extension <name>` | Root | Scaffold a new extension |

Individual packages also support `npm run check` and `npm test` from their directory.

## Git Hooks

Pre-commit and commit-msg hooks run via Husky on every commit.

### pre-commit

Runs scoped to **staged files only**:

1. **Biome** — format + lint on staged TS/JS/JSON files
2. **TypeScript** — `tsc --build` (incremental, only affected packages)
3. **Vitest** — `vitest related` on staged `.ts` files (skips test files in `scripts/test/`)

If you need to bypass hooks (e.g., WIP commits), use `git commit --no-verify`.

### commit-msg

Enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint:

```
feat(pi-template): add new tool
fix(pi-monorepo-registry): fix symlink conflict detection
docs: update contributing guide
chore: bump dependencies
```

| Type | Effect |
|------|--------|
| `feat` | Minor version bump |
| `fix` | Patch version bump |
| `feat!` or `BREAKING CHANGE` | Major version bump |

Scope should match the package name (e.g., `pi-template`, `pi-monorepo-registry`).

## CI

### Pull requests

The CI workflow dynamically discovers all packages under `packages/` and runs:

- **typecheck** — parallel job, `tsc --build` for all project references
- **lint** — parallel job, Biome check
- **test-package** — **parallel matrix**, one job per discovered package
- **test-scripts** — parallel job, tests for `scripts/`

Each package is tested in isolation. A failure in one package does not cancel others (`fail-fast: false`).

### Release (push to main)

[release-please](https://github.com/googleapis/release-please) runs in manifest mode, generating per-package release PRs based on conventional commits. Merging a release PR triggers `npm publish` to GitHub Packages.

## Code Style

- **Formatter**: Biome (tabs, 120 char line width)
- **Module system**: ESM (`"type": "module"`)
- **TypeScript**: Strict, composite project references
- **No build step**: Ship `.ts` source, pi loads via jiti

Run `npm run check` to verify. Biome auto-fixes are applied via the pre-commit hook.

## Writing a Good Extension README

Every extension must have its own `README.md` covering:

1. **What it does** — one-paragraph summary
2. **Installation** — the `pi install` command and any activation steps
3. **Usage** — commands, tools, and configuration with examples
4. **Configuration** — any environment variables or settings the extension reads
5. **Development** — how to run tests locally
6. **Testing** — test tier descriptions
7. **Package structure** — directory layout

See `packages/pi-template/README.md` for a complete example.
