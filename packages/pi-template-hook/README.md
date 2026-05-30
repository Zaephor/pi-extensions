# pi-template-hook

A minimal pi extension demonstrating the **`tool_call` interception pattern** — how to inspect, audit, or rewrite a tool's input before it executes.

This is a starter template. Copy it as the basis for any extension that needs to enforce policy, redact secrets, log activity, or otherwise mediate built-in tools.

## What it does

- Subscribes to the `tool_call` event.
- For every bash command, applies a list of redaction rules (default: `--token=`, `--api-key`, `AWS_SECRET*`, `GH_TOKEN`).
- If a rule matches, mutates `event.input.command` in place — the **redacted** command is what bash actually runs.
- Appends a structured `hook:bash-audit` session entry recording the (redacted) command and whether redaction fired.
- Registers no tools and no slash commands. Works entirely in the background.

## Pattern

```ts
pi.on("tool_call", (event, _ctx) => {
    if (event.toolName !== "bash") return;
    const bashEvent = event as BashToolCallEvent;

    // 1. Inspect
    const original = bashEvent.input.command;

    // 2. Mutate (optional)
    bashEvent.input.command = transformedCommand;

    // 3. Audit
    pi.appendEntry("my-hook:audit", { ... });
});
```

The same shape works for any tool: `read`, `write`, `edit`, custom tools registered by other extensions. Filter on `event.toolName`, then read/mutate `event.input`.

## When to use this pattern

| Use case | Why a hook fits |
|---|---|
| Secret/PII redaction | Catches every command before it runs and before it lands in session history |
| Confirmation gates | Block destructive commands until the user explicitly approves |
| Command prefixing | Add `time` / `niceness` / sandboxing wrappers transparently |
| Cross-cutting audit | One place to log all bash, all file edits, etc. |
| Lint / format on save | Intercept `edit` / `write` and run a transform |

## When NOT to use this pattern

- If you need to expose a *new* capability to the LLM, register a tool instead.
- If you need user-triggered behavior, register a slash command.

## Installation

```sh
pi install git:github.com/Zaephor/pi-extensions
/monorepo-package install pi-template-hook --dev <path-to-this-package>
/reload
```

## Files to adapt when forking

- `src/index.ts` — replace `DEFAULT_REDACTIONS` with whatever rules your hook needs, and pick the right `toolName` filter.
- `package.json` — `name`, `version`, description.
- `test/` — keep the unit tests on the pure transform function and adapt the integration test to your tool target.

## Development

```sh
npm test         # vitest
npm run check    # tsc --noEmit
```
