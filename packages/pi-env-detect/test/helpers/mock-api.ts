import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@earendil-works/pi-coding-agent";

/** Records registrations + flags so wiring tests can drive the extension. */
export function createMockAPI(flagDefaults: Record<string, string> = {}) {
	const tools: ToolDefinition[] = [];
	const commands = new Map<string, { handler: (args: string, ctx: any) => unknown }>();
	const events = new Map<string, ExtensionHandler<any, any>>();
	const flags = new Map<string, string | boolean | undefined>(Object.entries(flagDefaults));

	const api = {
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
		registerCommand(name: string, options: any) {
			commands.set(name, { handler: options.handler });
		},
		registerFlag(name: string, options: { default?: string | boolean }) {
			if (!flags.has(name)) flags.set(name, options.default);
		},
		getFlag(name: string) {
			return flags.get(name);
		},
		on(event: string, handler: ExtensionHandler<any, any>) {
			events.set(event, handler);
		},
		registerShortcut: () => {},
		registerMessageRenderer: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
	} as unknown as ExtensionAPI;

	return { api, tools, commands, events, flags };
}

export function createMockContext() {
	const notices: string[] = [];
	const ctx = { ui: { notify: (msg: string) => notices.push(msg) } } as any;
	return { ctx, notices };
}
