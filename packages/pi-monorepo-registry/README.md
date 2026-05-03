# pi-monorepo-registry

Discover and manage pi extension packages across monorepo sources.

## What It Does

pi-monorepo-registry registers slash commands for managing a registry of monorepo sources. It discovers pi-compatible packages within those sources (any directory with a `package.json` containing `pi.extensions` or the `pi-package` keyword) and handles symlink-based activation so pi can load them at runtime.

Key capabilities:

- **Source management** — Register, update, and remove monorepo git sources
- **Package discovery** — Automatically scan registered monorepos for pi-compatible packages
- **Install/uninstall** — Create or remove activation symlinks in global or local scope
- **Session history** — Record install/remove events via `pi.appendEntry()` for audit trails

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/monorepo-install pi-monorepo-registry
/reload
```

> If you have the full pi-extensions monorepo cloned, you can also activate it directly:
> ```
> /monorepo-install pi-monorepo-registry
> /reload
> ```

## Usage

### Register a monorepo source

```
/monorepo-registry add /path/to/my-monorepo packages
```

The second argument is the subdirectory containing packages (defaults to `packages`). The command scans for pi-compatible packages and reports how many were found.

You can also pass a git URL:

```
/monorepo-registry add https://github.com/user/my-pi-extensions
```

### List discovered packages

```
/monorepo-list
```

Shows all registered sources and their discovered packages with name, version, and description.

### Install a package

```
/monorepo-install my-extension
```

By default installs to **global** scope (available in all projects). Use the `-l` flag for local scope (current project only):

```
/monorepo-install my-extension -l
```

You can specify a source explicitly with `source/package` format:

```
/monorepo-install my-monorepo/my-extension
```

After installing, run `/reload` to activate the extension.

### Remove a package

```
/monorepo-remove my-extension
```

Supports `-l` for local scope. Run `/reload` after removing to deactivate.

### Update sources

```
/monorepo-registry update              # Update all sources
/monorepo-registry update my-monorepo  # Update a specific source
```

Re-scans the monorepo for new or changed packages.

### Remove a source

```
/monorepo-registry remove my-monorepo
```

## Configuration

No environment variables or settings files required. Registry state is held in-memory for the session duration.

The extension uses pi's standard agent directory for global-scope symlinks:

- **Global**: `$AGENT_DIR/extensions/<package-name>` — where `$AGENT_DIR` is resolved by `getAgentDir()` from the pi SDK
- **Local**: `<cwd>/extensions/<package-name>` — relative to the current working directory

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

Run tests from the root or from `packages/pi-monorepo-registry`:

```sh
npm test
```

The test suite has four tiers:

| Tier | File | What it verifies |
|------|------|------------------|
| Unit | `test/unit.test.ts` | Registry operations, discovery logic, symlink management |
| Integration | `test/integration.test.ts` | Full command registration and handler execution |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension via `SessionManager` |

## Package Structure

```
packages/pi-monorepo-registry/
├── src/
│   ├── index.ts         # Default export: registers all commands
│   ├── activation.ts    # Symlink creation/removal for package activation
│   ├── discovery.ts     # Walks directories to find pi-compatible packages
│   ├── registry.ts      # MonorepoRegistry class — source CRUD and state
│   ├── deps.ts          # node_modules existence checks
│   └── types.ts         # TypeScript types (RegistryState, PackageInfo, Scope)
├── test/
│   ├── helpers/
│   │   ├── fixture.ts   # Test fixture monorepo creation
│   │   └── mock-api.ts  # Mock ExtensionAPI for unit/integration tests
│   ├── unit.test.ts
│   ├── integration.test.ts
│   ├── package-shape.test.ts
│   └── sdk-e2e.test.ts
└── package.json
```

## Package Discovery

A package is considered discoverable when its `package.json` contains either:

- A `pi` field with an `extensions` array, OR
- The keyword `pi-package` in its `keywords` array.

The discovery algorithm walks immediate subdirectories of the configured packages root and checks each for these criteria.
