/**
 * Reusable mock for ExtensionAPI, adapted for pi-monorepo-registry tests.
 * Extends the pi-template mock pattern with appendEntry tracking.
 */
import type { ExtensionAPI, ExtensionHandler } from "@earendil-works/pi-coding-agent";

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

/** A single recorded appendEntry call. */
export interface CapturedEntry {
	type: string;
	data?: unknown;
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
 * Create a mock ExtensionAPI that records all registrations and appendEntry calls.
 */
export function createMockAPI() {
	const commands: CapturedCommand[] = [];
	const events: CapturedEvent[] = [];
	const entries: CapturedEntry[] = [];

	const api = {
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

		appendEntry(type: string, data?: unknown) {
			entries.push({ type, data });
		},

		// Stubs for the rest of ExtensionAPI
		registerTool: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => undefined,
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
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

	return { api, commands, events, entries };
}
