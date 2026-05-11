# pi-monorepo-registry

A pure package manager for [pi](https://github.com/nicepkg/pi) extensions. Register monorepo sources, discover pi-compatible packages, and install them so pi/gsd's native extension loader can find them.

This is **not** a runtime or plugin loader — it manages package registration in `settings.json` and creates symlinks or extracts tarballs so that pi's built-in extension system discovers and loads them.

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/reload
```

After installing, two commands become available: `/monorepo-registry` and `/monorepo-package`.

## Commands

### `/monorepo-registry` — Manage monorepo sources

#### Add a source

```
/monorepo-registry add <url-or-path> [packages-root]
```

Registers a monorepo source and scans it for pi-compatible packages. The optional `packages-root` argument specifies the subdirectory containing packages (defaults to `packages`).

```sh
# From a git URL
/monorepo-registry add https://github.com/user/my-pi-extensions

# From a local path with custom packages root
/monorepo-registry add /path/to/my-monorepo plugins
```

#### Remove a source

```
/monorepo-registry remove <source>
```

Removes a registered source by URL or short name.

#### List sources

```
/monorepo-registry list
```

Shows all registered sources, their discovered packages (with name, version, description), and highlights duplicate package names across sources.

#### Update sources

```
/monorepo-registry update              # Re-scan all sources
/monorepo-registry update my-monorepo  # Re-san a specific source
```

Re-discovers packages in the source, picking up any additions or changes.

### `/monorepo-package` — Install, remove, update, and list packages

#### Install (dev mode — symlink to local checkout)

```
/monorepo-package install <name> --dev <path>
```

Creates a symlink from the extensions directory to a local package checkout. Ideal for active development where changes should be reflected immediately.

```sh
/monorepo-package install my-extension --dev /projects/my-extension
```

#### Install (git mode — clone + symlink)

```
/monorepo-package install <name> --git
```

Clones (or reuses) the source repository and creates a symlink to the package directory within it.

```sh
/monorepo-package install my-extension --git
```

#### Install (tarball mode — download, default)

```
/monorepo-package install <name>                    # Latest from discovered version
/monorepo-package install <name> --version 1.2.0    # Specific version
/monorepo-package install <name> --source <url>     # Explicit source
```

Downloads a release tarball from GitHub and extracts it into the extensions directory. This is the default mode when no flags are specified.

#### Remove

```
/monorepo-package remove <name>
```

Removes the installed package — deletes symlinks (dev/git) or extracted directories (tarball) and unregisters from settings.

#### Update

```
/monorepo-package update <name> [--version <semver>]
```

Downloads a new version of a tarball-installed package and atomically swaps it in place. Only supported for tarball-activated packages — dev and git packages should be updated at their source.

#### List

```
/monorepo-package list
```

Shows all installed packages with their activation mode, source, install date, and target path.

## Activation Modes

| Mode | Flag | How it works | Best for |
|------|------|--------------|----------|
| **Dev** | `--dev <path>` | Symlink to local checkout | Active development — changes reflect immediately |
| **Git** | `--git` | Clone source repo + symlink | Tracking upstream without modifying |
| **Tarball** | *(default)* | Download GitHub release tarball | Production use — reproducible, no git required |

All three modes register the extension in `settings.json` so pi/gsd discovers it on the next `/reload`.

## Agent Isolation

State and extensions are stored per-agent — there is no cross-contamination:

```
~/.pi/monorepo/          ← pi agent
├── extensions/          ← installed packages
├── git/                 ← cloned source repos
└── state.json           ← registry + install state

~/.gsd/monorepo/         ← gsd agent (same layout)
├── extensions/
├── git/
└── state.json
```

The agent directory is resolved at runtime via the pi SDK's `getAgentDir()` — pi uses `~/.pi/`, gsd uses `~/.gsd/`. Each agent maintains its own independent registry and installed packages.

## Package Discovery

A package is discoverable when its `package.json` contains **either**:

- A `pi` field with an `extensions` array:
  ```json
  { "pi": { "extensions": ["./src/index.ts"] } }
  ```

- The keyword `pi-package` in its `keywords` array:
  ```json
  { "keywords": ["pi-package"] }
  ```

The discovery algorithm walks immediate subdirectories of the configured packages root and checks each for these criteria.

## Package Structure

```
packages/pi-monorepo-registry/
├── src/
│   ├── index.ts          # Extension entry — registers commands, session_start handler
│   ├── discovery.ts      # Walks directories to find pi-compatible packages
│   ├── git.ts            # Git URL parsing, short name extraction, clone resolution
│   ├── packages.ts       # PackageManager — install/remove/update lifecycle
│   ├── paths.ts          # Agent-scoped filesystem paths
│   ├── persistence.ts    # Load/save registry state from disk
│   ├── registry.ts       # MonorepoRegistry — source CRUD and package discovery
│   ├── settings.ts       # Register/unregister extension paths in settings.json
│   ├── tarball.ts        # GitHub release tarball download and extraction
│   └── types.ts          # TypeScript types (RegistryState, PackageInfo, ActivationMode)
├── test/
│   ├── helpers/
│   │   ├── fixture.ts    # Test fixture monorepo creation
│   │   └── mock-api.ts   # Mock ExtensionAPI for unit/integration tests
│   ├── unit.test.ts
│   ├── integration.test.ts
│   ├── package-shape.test.ts
│   ├── sdk-e2e.test.ts
│   ├── cross-runtime-e2e.test.ts
│   ├── s01-paths.test.ts
│   ├── s01-persistence.test.ts
│   ├── s01-settings.test.ts
│   ├── s02-packages.test.ts
│   └── s02-tarball.test.ts
└── package.json
```

## Testing

Run from the monorepo root or from `packages/pi-monorepo-registry`:

```sh
npm test
```

The test suite has four tiers plus cross-runtime and per-slice test files:

| Tier | Files | What it verifies |
|------|-------|------------------|
| Unit | `test/unit.test.ts`, `test/s01-*.test.ts` | Registry operations, path resolution, persistence, settings management |
| Integration | `test/integration.test.ts` | Full command registration and handler execution |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields, correct file structure |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension via `SessionManager` |
| Cross-runtime e2e | `test/cross-runtime-e2e.test.ts` | Extension loads correctly under both pi and gsd SDK runtimes |
| Slice tests | `test/s02-*.test.ts` | PackageManager install/remove/update, tarball download and extraction |

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

From the monorepo root:

```sh
npm run typecheck   # type-check all packages
npm run check       # lint all files with Biome
npm run test        # run all tests
npm run check:all   # typecheck + lint + test
```
