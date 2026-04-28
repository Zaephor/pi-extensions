# pi-monorepo-registry

Discover and manage packages across monorepo sources.

## Commands

- `/monorepo-list` — List all registered monorepos and their discovered packages
- `/monorepo-install <source>/<package>` — Install a package from a registered monorepo
- `/monorepo-remove <package>` — Remove an installed package
- `/monorepo-registry add <url>` — Register a monorepo source
- `/monorepo-registry remove <url>` — Remove a registered monorepo source

## Development

```bash
npm run check      # Type check
npm run test       # Run tests
```
