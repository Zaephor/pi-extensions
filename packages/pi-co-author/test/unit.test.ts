import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { appendTrailers, detectAgent, formatModelName, isGitCommit, type TrailerOptions } from "../src/commit.js";
import { DEFAULT_MODE, FLAG_NAME, parseConfig } from "../src/config.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
		id: "claude-sonnet-4-20250514",
		name: "Claude 4 Sonnet",
		api: "anthropic-messages" as Api,
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 16384,
		...overrides,
	};
}

const defaultOpts: TrailerOptions = {
	mode: "single",
	agent: "Pi",
	modelName: "Claude 4 Sonnet",
};

// ─── isGitCommit ─────────────────────────────────────────────────────

describe("isGitCommit", () => {
	// --- Positive cases ---

	it("matches basic: git commit -m 'msg'", () => {
		expect(isGitCommit('git commit -m "hello"')).toBe(true);
	});

	it("matches single-quoted message", () => {
		expect(isGitCommit("git commit -m 'hello'")).toBe(true);
	});

	it("matches combined flags: git commit -am 'msg'", () => {
		expect(isGitCommit("git commit -am 'stage all'")).toBe(true);
	});

	it("matches long flag: git commit --message='msg'", () => {
		expect(isGitCommit("git commit --message='hello world'")).toBe(true);
	});

	it("matches long flag with double quotes", () => {
		expect(isGitCommit('git commit --message="hello world"')).toBe(true);
	});

	it("matches multiline with ANSI-C quoting", () => {
		expect(isGitCommit("git commit -m $'line1\\nline2'")).toBe(true);
	});

	it("matches with leading/trailing whitespace", () => {
		expect(isGitCommit('  git commit -m "msg"  ')).toBe(true);
	});

	it("matches -m at end of command (no trailing content)", () => {
		expect(isGitCommit('git commit -m "msg"')).toBe(true);
	});

	// --- Negative cases ---

	it("rejects git commit --amend", () => {
		expect(isGitCommit('git commit --amend -m "fix"')).toBe(false);
	});

	it("rejects git commit -F file", () => {
		expect(isGitCommit("git commit -F msg.txt")).toBe(false);
	});

	it("rejects git commit --file=msg.txt", () => {
		expect(isGitCommit("git commit --file=msg.txt")).toBe(false);
	});

	it("rejects git commit with no -m flag", () => {
		expect(isGitCommit("git commit")).toBe(false);
	});

	it("rejects git log", () => {
		expect(isGitCommit("git log")).toBe(false);
	});

	it("rejects git status", () => {
		expect(isGitCommit("git status")).toBe(false);
	});

	it("rejects empty string", () => {
		expect(isGitCommit("")).toBe(false);
	});

	// --- cd/chain prefix cases (pi prepends "cd /workspace &&" to bash commands) ---

	it("matches cd prefix: cd /workspace && git commit -m 'msg'", () => {
		expect(isGitCommit('cd /workspace/950e277ec2d0 && git commit -m "test diag"')).toBe(true);
	});

	it("matches cd prefix with chained add: cd ... && git add ... && git commit -m 'msg'", () => {
		expect(isGitCommit('cd /workspace/foo && git add file.txt && git commit -m "test"')).toBe(true);
	});

	it("matches semicolon separator: cd /foo; git commit -m 'msg'", () => {
		expect(isGitCommit('cd /foo; git commit -m "msg"')).toBe(true);
	});

	it("matches || separator: cd /foo || git commit -m 'msg'", () => {
		expect(isGitCommit('cd /foo || git commit -m "msg"')).toBe(true);
	});

	it("matches cd prefix with combined flags: cd ... && git commit -am 'msg'", () => {
		expect(isGitCommit('cd /workspace && git commit -am "stage all"')).toBe(true);
	});

	it("matches cd prefix with --message=: cd ... && git commit --message='msg'", () => {
		expect(isGitCommit("cd /workspace && git commit --message='hello'")).toBe(true);
	});

	it("rejects cd prefix with --amend: cd ... && git commit --amend -m 'msg'", () => {
		expect(isGitCommit('cd /workspace && git commit --amend -m "fix"')).toBe(false);
	});

	it("rejects cd prefix with -F: cd ... && git commit -F msg.txt", () => {
		expect(isGitCommit("cd /workspace && git commit -F msg.txt")).toBe(false);
	});

	it("rejects cd prefix with no -m: cd ... && git commit", () => {
		expect(isGitCommit("cd /workspace && git commit")).toBe(false);
	});

	it("rejects cd prefix with git status: cd ... && git status", () => {
		expect(isGitCommit("cd /workspace && git status")).toBe(false);
	});

	it("rejects random command", () => {
		expect(isGitCommit("npm run build")).toBe(false);
	});

	it("rejects git commit -F at end of line", () => {
		expect(isGitCommit("git commit -F")).toBe(false);
	});
});

// ─── appendTrailers ──────────────────────────────────────────────────

describe("appendTrailers", () => {
	describe("mode: disabled", () => {
		it("returns cmd unchanged", () => {
			const cmd = 'git commit -m "hello"';
			const result = appendTrailers(cmd, { ...defaultOpts, mode: "disabled" });
			expect(result).toBe(cmd);
		});
	});

	describe("mode: single", () => {
		it("appends Co-Authored-By trailer to double-quoted message", () => {
			const result = appendTrailers('git commit -m "hello"', defaultOpts);
			expect(result).toContain("Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>");
			expect(result).toContain("hello");
		});

		it("appends trailer to single-quoted message", () => {
			const result = appendTrailers("git commit -m 'hello'", defaultOpts);
			expect(result).toContain("Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>");
		});

		it("appends trailer to --message= form", () => {
			const result = appendTrailers('git commit --message="hello"', defaultOpts);
			expect(result).toContain("Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>");
		});

		it("uses the provided agent name", () => {
			const opts: TrailerOptions = { ...defaultOpts, agent: "GSD" };
			const result = appendTrailers('git commit -m "hello"', opts);
			expect(result).toContain("Co-Authored-By: GSD <Claude 4 Sonnet> <noreply@pi.dev>");
		});

		it("uses the provided model name", () => {
			const opts: TrailerOptions = { ...defaultOpts, modelName: "GPT-4o" };
			const result = appendTrailers('git commit -m "hello"', opts);
			expect(result).toContain("Co-Authored-By: Pi <GPT-4o> <noreply@pi.dev>");
		});

		it("appends trailer to cd-prefixed command with && chain", () => {
			const cmd = 'cd /workspace/950e277ec2d0 && git add file.txt && git commit -m "test diag"';
			const result = appendTrailers(cmd, defaultOpts);
			expect(result).toContain("Co-Authored-By: Pi <Claude 4 Sonnet> <noreply@pi.dev>");
			expect(result).toContain("test diag");
			expect(result).toContain("cd /workspace/950e277ec2d0 && git add file.txt &&");
		});
	});

	describe("mode: split", () => {
		const splitOpts: TrailerOptions = { ...defaultOpts, mode: "split" };

		it("appends both Co-Authored-By and Generated-By trailers", () => {
			const result = appendTrailers('git commit -m "hello"', splitOpts);
			expect(result).toContain("Co-Authored-By: Claude 4 Sonnet <noreply@pi.dev>");
			expect(result).toContain("Generated-By: Pi");
		});

		it("includes version in Generated-By when provided", () => {
			const opts: TrailerOptions = { ...splitOpts, version: "1.0.0" };
			const result = appendTrailers('git commit -m "hello"', opts);
			expect(result).toContain("Generated-By: Pi v1.0.0");
		});

		it("omits version suffix when not provided", () => {
			const result = appendTrailers('git commit -m "hello"', splitOpts);
			const genByMatch = result.match(/Generated-By: .*/);
			expect(genByMatch).toBeDefined();
			expect(genByMatch![0]).not.toContain("v");
		});
	});
});

// ─── detectAgent ─────────────────────────────────────────────────────

describe("detectAgent", () => {
	const origAppName = process.env.APP_NAME;
	const origPkgDir = process.env.PI_PACKAGE_DIR;

	function restoreEnv() {
		if (origAppName !== undefined) {
			process.env.APP_NAME = origAppName;
		} else {
			delete process.env.APP_NAME;
		}
		if (origPkgDir !== undefined) {
			process.env.PI_PACKAGE_DIR = origPkgDir;
		} else {
			delete process.env.PI_PACKAGE_DIR;
		}
	}

	it('returns "Pi" by default (no env vars)', () => {
		delete process.env.APP_NAME;
		delete process.env.PI_PACKAGE_DIR;
		const result = detectAgent();
		restoreEnv();
		expect(result).toBe("Pi");
	});

	it('returns "GSD" when APP_NAME contains "gsd"', () => {
		process.env.APP_NAME = "gsd";
		const result = detectAgent();
		restoreEnv();
		expect(result).toBe("GSD");
	});

	it('returns "GSD" when APP_NAME is uppercase "GSD"', () => {
		process.env.APP_NAME = "GSD";
		const result = detectAgent();
		restoreEnv();
		expect(result).toBe("GSD");
	});

	it('returns "GSD" when PI_PACKAGE_DIR contains "gsd"', () => {
		delete process.env.APP_NAME;
		process.env.PI_PACKAGE_DIR = "/opt/gsd/bin";
		const result = detectAgent();
		restoreEnv();
		expect(result).toBe("GSD");
	});

	it('returns "Pi" when APP_NAME is "pi"', () => {
		process.env.APP_NAME = "pi";
		delete process.env.PI_PACKAGE_DIR;
		const result = detectAgent();
		restoreEnv();
		expect(result).toBe("Pi");
	});
});

// ─── formatModelName ─────────────────────────────────────────────────

describe("formatModelName", () => {
	it("returns model.name when available", () => {
		const model = makeModel({ name: "Claude 4 Sonnet", id: "claude-sonnet-4" });
		expect(formatModelName(model)).toBe("Claude 4 Sonnet");
	});

	it("falls back to model.id when name is empty", () => {
		const model = makeModel({ name: "", id: "gpt-4o" });
		expect(formatModelName(model)).toBe("gpt-4o");
	});

	it("returns 'unknown' for undefined model", () => {
		expect(formatModelName(undefined)).toBe("unknown");
	});

	it("returns 'unknown' when both name and id are empty", () => {
		const model = makeModel({ name: "", id: "" });
		expect(formatModelName(model)).toBe("unknown");
	});

	it("returns model.id when name is undefined-ish but id is set", () => {
		const model = makeModel({ id: "gemini-2.5-pro" });
		// name is set to "Gemini 2.5 Pro" by makeModel defaults via overrides...
		// Let's be explicit:
		(model as any).name = "";
		expect(formatModelName(model)).toBe("gemini-2.5-pro");
	});
});

// ─── parseConfig ─────────────────────────────────────────────────────

describe("parseConfig", () => {
	it("returns default mode for undefined input", () => {
		const config = parseConfig(undefined);
		expect(config.mode).toBe("single");
	});

	it("returns default mode for null input", () => {
		const config = parseConfig(null);
		expect(config.mode).toBe("single");
	});

	it("parses 'single' mode from string", () => {
		const config = parseConfig("single");
		expect(config.mode).toBe("single");
	});

	it("parses 'split' mode from string", () => {
		const config = parseConfig("split");
		expect(config.mode).toBe("split");
	});

	it("parses 'disabled' mode from string", () => {
		const config = parseConfig("disabled");
		expect(config.mode).toBe("disabled");
	});

	it("is case-insensitive", () => {
		expect(parseConfig("Single").mode).toBe("single");
		expect(parseConfig("SPLIT").mode).toBe("split");
		expect(parseConfig("Disabled").mode).toBe("disabled");
	});

	it("trims whitespace from string input", () => {
		expect(parseConfig("  split  ").mode).toBe("split");
	});

	it("falls back to default for invalid string", () => {
		expect(parseConfig("invalid").mode).toBe(DEFAULT_MODE);
	});

	it("parses object with mode field", () => {
		const config = parseConfig({ mode: "split" });
		expect(config.mode).toBe("split");
	});

	it("falls back to default for object with invalid mode", () => {
		const config = parseConfig({ mode: "unknown" });
		expect(config.mode).toBe(DEFAULT_MODE);
	});

	it("falls back to default for object with non-string mode", () => {
		const config = parseConfig({ mode: 42 });
		expect(config.mode).toBe(DEFAULT_MODE);
	});

	it("falls back to default for empty object", () => {
		const config = parseConfig({});
		expect(config.mode).toBe(DEFAULT_MODE);
	});

	it("falls back to default for number input", () => {
		expect(parseConfig(123).mode).toBe(DEFAULT_MODE);
	});

	it("falls back to default for array input", () => {
		expect(parseConfig(["split"]).mode).toBe(DEFAULT_MODE);
	});

	it("falls back to default for boolean input", () => {
		expect(parseConfig(true).mode).toBe(DEFAULT_MODE);
	});
});

// ─── Config constants ────────────────────────────────────────────────

describe("config constants", () => {
	it("exports the expected flag name", () => {
		expect(FLAG_NAME).toBe("co-author-mode");
	});

	it("exports the expected default mode", () => {
		expect(DEFAULT_MODE).toBe("single");
	});
});
