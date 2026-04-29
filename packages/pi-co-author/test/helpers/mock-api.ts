/**
 * Reusable mock for ExtensionAPI, capturing registerTool/registerCommand/on calls
 * so unit tests can assert on what the extension registered.
 */
import type { ExtensionAPI, ExtensionHandler, ToolDefinition } from "@mariozechner/pi-coding-agent";

/** A single captured tool registration. */
export interface CapturedTool {
	tool: ToolDefinition;
}

/** A single captured command registration. */
export interface CapturedCommand {
	name: string;
	description?: string;
	handler: (args: string, ctx: any) => Promise<void> | void;
}

/** A single captured event subscription. */
export interface CapturedEvent {
	event: string;
	handler: ExtensionHandler<any, any>;
}

/** Minimal mock context passed to command/event handlers during tests. */
export function createMockContext(overrides?: Partial<{ notify: (...args: any[]) => void }>) {
	return {
		ui: {
			notify: overrides?.notify ?? (() => {}),
		},
		hasUI: true,
		cwd: "/tmp",
		sessionManager: {} as any,
		modelRegistry: {} as any,
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

/**
 * Create a mock ExtensionAPI that records all registrations.
 *
 * Usage:
 *   const { api, tools, commands, events } = createMockAPI();
 *   extensionFactory(api);
 *   expect(tools).toHaveLength(1);
 */
export function createMockAPI() {
	const tools: CapturedTool[] = [];
	const commands: CapturedCommand[] = [];
	const events: CapturedEvent[] = [];

	const api = {
		registerTool(tool: ToolDefinition) {
			tools.push({ tool });
		},

		registerCommand(name: string, options: any) {
			commands.push({
				name,
				description: options.description,
				handler: options.handler,
			});
		},

		on(event: string, handler: ExtensionHandler<any, any>) {
			events.push({ event, handler });
		},

		// Stubs for the rest of ExtensionAPI — not needed for unit tests
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
		setSessionName: () => {},
		getSessionName: () => undefined,
		setLabel: () => {},
		exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
		getActiveTools: () => [] as string[],
		getAllTools: () => [] as any[],
		setActiveTools: () => {},
		getCommands: () => [] as any[],
		setModel: async () => false,
		getThinkingLevel: () => "none" as any,
		setThinkingLevel: () => {},
		registerProvider: () => {},
	} as unknown as ExtensionAPI;

	return { api, tools, commands, events };
}
