# pi-monorepo-registry

A pure package manager for [pi](https://github.com/earendil-works/pi) extensions. Register monorepo sources, discover pi-compatible packages, and install them so pi's native extension loader can find them.

This is **not** a runtime or plugin loader — it manages package registration in `settings.json` and creates symlinks or extracts tarballs so that pi's built-in extension system discovers and loads them.

## Platform support

POSIX only (Linux, macOS). Tarball extraction and git clones shell out to
`tar` and `git`, both of which must be on `$PATH`. Windows is not exercised
by CI and not currently supported.

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/reload
```

After installing, two commands become available: `/monorepo-registry` and `/monorepo-package`.

> `pi install` is provided by [pi](https://github.com/earendil-works/pi) itself — this repo's tests verify the registry's behaviour once pi has loaded it (discovery, install/remove/update, settings.json bridging). The install handshake (cloning the git URL, locating extensions in the loaded repo) is pi's responsibility, not this package's.

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

All three modes register the extension in `settings.json` so pi discovers it on the next `/reload`.

## Layout

State and extensions live under the pi agent dir:

```
~/.pi/monorepo/          ← resolved via pi SDK getAgentDir()
├── extensions/          ← installed packages
├── git/                 ← cloned source repos
└── state.json           ← registry + install state
```

The path is computed via the pi SDK's `getAgentDir()` at runtime, so it honours `PI_CODING_AGENT_DIR` overrides for testing.

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
│   ├── runtime-e2e.test.ts
│   ├── git-integration.test.ts   # SSH/HTTPS normalization, isSelfUrl, symlink resolution
│   ├── stale-clone.test.ts       # Regression: fetch+reset vs pull --ff-only on diverged clones
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

The test suite has four tiers plus runtime, per-slice, and regression test files:

| Tier | Files | What it verifies |
|------|-------|------------------|
| Unit | `test/unit.test.ts`, `test/s01-*.test.ts` | Registry operations, path resolution, persistence, settings management |
| Integration | `test/integration.test.ts` | Full command registration and handler execution |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields, correct file structure |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension via `SessionManager` |
| Runtime e2e | `test/runtime-e2e.test.ts` | Extension loads correctly under the pi SDK runtime |
| Slice tests | `test/s02-*.test.ts` | PackageManager install/remove/update, tarball download and extraction |
| Git integration | `test/git-integration.test.ts` | SSH/HTTPS URL normalization, `isSelfUrl` against the real workspace remote, local-path symlink resolution, version refresh from disk |
| Stale clone regression | `test/stale-clone.test.ts` | Repros that `git pull --ff-only` fails on diverged shallow clones while `fetch + reset` succeeds |

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
