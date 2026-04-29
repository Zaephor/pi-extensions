# pi-co-author

A pi extension.

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/monorego-install pi-co-author
/reload
```


## Usage

The `pi-co-author` tool is invoked automatically by the LLM when relevant.

### session_start notification

When a session begins, the extension prints:

```
pi-co-author extension loaded ✅
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
| Unit | `test/unit.test.ts` | Tool handler in isolation |
| Integration | `test/integration.test.ts` | Factory function registers extensions correctly |
| Package shape | `test/package-shape.test.ts` | `package.json` has required pi manifest fields |
| SDK e2e | `test/sdk-e2e.test.ts` | Full pi runtime loads the extension |
| Index | `test/index.test.ts` | Re-exports and entry point validation |
