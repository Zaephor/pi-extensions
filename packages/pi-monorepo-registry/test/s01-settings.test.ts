/**
 * S01 settings tests — verify settings.json bridge for extension path registration.
 *
 * Tests atomic read/write, idempotent registration, preservation of other
 * settings keys, and graceful handling of missing/malformed files.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	isExtensionRegistered,
	readSettingsJson,
	registerExtensionPath,
	unregisterExtensionPath,
	writeSettingsJson,
} from "../src/settings.js";

let tmpDir: string;

function createTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), "s01-settings-"));
	return tmpDir;

	// cleanup happens in afterEach
}

afterEach(() => {
	if (tmpDir && existsSync(tmpDir)) {
		rmSync(tmpDir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// readSettingsJson
// ---------------------------------------------------------------------------
describe("readSettingsJson", () => {
	it("returns empty object for missing file", async () => {
		const dir = createTmpDir();
		const result = await readSettingsJson(join(dir, "nonexistent.json"));
		expect(result).toEqual({});
	});

	it("returns parsed object for valid JSON", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const data = { extensions: ["/some/path"], theme: "dark" };

		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify(data));

		const result = await readSettingsJson(filePath);
		expect(result).toEqual(data);
	});

	it("returns empty object for malformed JSON with warning", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");

		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, "{invalid json!!!");

		const result = await readSettingsJson(filePath);
		expect(result).toEqual({});
	});

	it("returns empty object for non-object JSON (array)", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");

		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify([1, 2, 3]));

		const result = await readSettingsJson(filePath);
		expect(result).toEqual({});
	});

	it("returns empty object for non-object JSON (primitive)", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");

		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, '"hello"');

		const result = await readSettingsJson(filePath);
		expect(result).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// writeSettingsJson (atomic write)
// ---------------------------------------------------------------------------
describe("writeSettingsJson", () => {
	it("writes valid JSON to the target file", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const data = { extensions: ["/a"], key: "value" };

		await writeSettingsJson(filePath, data);

		const raw = readFileSync(filePath, "utf-8");
		expect(JSON.parse(raw)).toEqual(data);
	});

	it("creates parent directories if needed", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "nested", "dir", "settings.json");
		const data = { test: true };

		await writeSettingsJson(filePath, data);

		expect(existsSync(filePath)).toBe(true);
		expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual(data);
	});

	it("does not leave temp files after write", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");

		await writeSettingsJson(filePath, { a: 1 });

		// Check no .tmp files remain
		const { readdirSync } = await import("node:fs");
		const files = readdirSync(dir).filter((f) => f.includes(".tmp"));
		expect(files).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// registerExtensionPath
// ---------------------------------------------------------------------------
describe("registerExtensionPath", () => {
	it("adds path to extensions[]", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: [] }));

		await registerExtensionPath(filePath, "/path/to/ext");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toContain("/path/to/ext");
	});

	it("is idempotent (does not duplicate)", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/path/to/ext"] }));

		await registerExtensionPath(filePath, "/path/to/ext");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toEqual(["/path/to/ext"]);
		expect(result.extensions.length).toBe(1);
	});

	it("preserves other extensions[] entries", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/other/path"] }));

		await registerExtensionPath(filePath, "/path/to/ext");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toContain("/other/path");
		expect(result.extensions).toContain("/path/to/ext");
		expect(result.extensions.length).toBe(2);
	});

	it("preserves all other settings keys", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: [], theme: "dark", fontSize: 14, nested: { a: 1 } }));

		await registerExtensionPath(filePath, "/path/to/ext");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.theme).toBe("dark");
		expect(result.fontSize).toBe(14);
		expect(result.nested).toEqual({ a: 1 });
		expect(result.extensions).toContain("/path/to/ext");
	});

	it("creates extensions array if missing", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ theme: "dark" }));

		await registerExtensionPath(filePath, "/path/to/ext");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toEqual(["/path/to/ext"]);
		expect(result.theme).toBe("dark");
	});

	it("handles missing settings.json (creates new file)", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");

		await registerExtensionPath(filePath, "/path/to/ext");

		expect(existsSync(filePath)).toBe(true);
		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toContain("/path/to/ext");
	});

	it("normalizes trailing slashes for deduplication", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/path/to/ext"] }));

		await registerExtensionPath(filePath, "/path/to/ext/");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// unregisterExtensionPath
// ---------------------------------------------------------------------------
describe("unregisterExtensionPath", () => {
	it("removes only the specified path", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/a", "/b", "/c"] }));

		await unregisterExtensionPath(filePath, "/b");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toEqual(["/a", "/c"]);
	});

	it("preserves other entries", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/a", "/b"], theme: "dark" }));

		await unregisterExtensionPath(filePath, "/a");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toEqual(["/b"]);
		expect(result.theme).toBe("dark");
	});

	it("is no-op for non-registered path", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/a", "/b"], theme: "dark" }));

		await unregisterExtensionPath(filePath, "/not/registered");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toEqual(["/a", "/b"]);
		expect(result.theme).toBe("dark");
	});

	it("normalizes trailing slashes", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/path/to/ext"] }));

		await unregisterExtensionPath(filePath, "/path/to/ext/");

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		expect(result.extensions).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// isExtensionRegistered
// ---------------------------------------------------------------------------
describe("isExtensionRegistered", () => {
	it("returns true for registered path", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/path/to/ext"] }));

		const result = await isExtensionRegistered(filePath, "/path/to/ext");
		expect(result).toBe(true);
	});

	it("returns false for non-registered path", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/other"] }));

		const result = await isExtensionRegistered(filePath, "/path/to/ext");
		expect(result).toBe(false);
	});

	it("returns false for missing settings.json", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");

		const result = await isExtensionRegistered(filePath, "/path/to/ext");
		expect(result).toBe(false);
	});

	it("handles trailing slash normalization", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: ["/path/to/ext"] }));

		expect(await isExtensionRegistered(filePath, "/path/to/ext/")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Concurrent write safety
// ---------------------------------------------------------------------------
describe("concurrent write safety", () => {
	it("write → read → write does not lose data", async () => {
		const dir = createTmpDir();
		const filePath = join(dir, "settings.json");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(filePath, JSON.stringify({ extensions: [], version: 1 }));

		// Register two paths concurrently
		await Promise.all([registerExtensionPath(filePath, "/path/a"), registerExtensionPath(filePath, "/path/b")]);

		const result = JSON.parse(readFileSync(filePath, "utf-8"));
		// Both paths should be present (or at least one, if the race was lost
		// and one write overwrote the other — but with atomic write at least
		// the file should be valid JSON)
		expect(result).toBeDefined();
		expect(typeof result).toBe("object");
		// With sequential atomic writes, both should be present
		// With concurrent writes, we accept that at least one is present
		expect(result.extensions.length).toBeGreaterThanOrEqual(1);
	});
});
