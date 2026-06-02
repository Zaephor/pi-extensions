import { describe, expect, it } from "vitest";
import {
	assertFellThrough,
	assertHandledOffline,
	binaryPackageRoot,
	type PiStepResult,
	pkgVersionAt,
	sdkPackageRoot,
} from "../registry-e2e.js";

function result(partial: Partial<PiStepResult>): PiStepResult {
	return { events: [], stdout: "", stderr: "", exitCode: 0, timedOut: false, ...partial };
}

describe("registry-e2e harness: assertHandledOffline", () => {
	it("passes for a clean handled step", () => {
		expect(() => assertHandledOffline(result({ events: [{ type: "session" }] }))).not.toThrow();
	});

	it("throws when agent_start is present (LLM fallthrough)", () => {
		expect(() => assertHandledOffline(result({ events: [{ type: "agent_start" }] }))).toThrow(/fell through/i);
	});

	it("throws on missing-API-key fallthrough", () => {
		expect(() => assertHandledOffline(result({ stdout: "No API key found for model" }))).toThrow(/No API key/i);
	});

	it("throws on non-zero exit", () => {
		expect(() => assertHandledOffline(result({ exitCode: 1 }))).toThrow(/exited 1/);
	});

	it("throws on timeout", () => {
		expect(() => assertHandledOffline(result({ timedOut: true }))).toThrow(/timed out/i);
	});
});

describe("registry-e2e harness: assertFellThrough", () => {
	it("passes when agent_start present", () => {
		expect(() => assertFellThrough(result({ events: [{ type: "agent_start" }] }))).not.toThrow();
	});

	it("throws when the command was actually handled", () => {
		expect(() => assertFellThrough(result({ events: [{ type: "session" }] }))).toThrow(/Expected fallthrough/i);
	});

	it("throws on timeout", () => {
		expect(() => assertFellThrough(result({ timedOut: true }))).toThrow(/timed out/i);
	});
});

describe("registry-e2e harness: version coherence", () => {
	it("binary and SDK resolve to the same install", () => {
		expect(binaryPackageRoot()).toBe(sdkPackageRoot());
	});

	it("binary and SDK report the same semver", () => {
		expect(pkgVersionAt(binaryPackageRoot())).toBe(pkgVersionAt(sdkPackageRoot()));
	});
});
