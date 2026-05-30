/**
 * e2e test for pi-co-author — install via pi-monorepo-registry, then assert
 * the extension symlink and package.json shape land correctly, and that pi
 * loads it without errors so the co-author-mode flag + tool_call handler are
 * registered.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getExtensionsDirFor,
	installViaRegistry,
	isSymlinked,
	loadViaPi,
	makeExtensionsDir,
	makeTemp,
	nextId,
	resetIds,
} from "../../../shared/test/cross-runtime-helpers.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const pkgName = "pi-co-author";
const registrySrc = path.resolve(__dirname, "../../pi-monorepo-registry/src/index.ts");
const repoRoot = path.resolve(__dirname, "../../..");

resetIds();

describe("Install pi-co-author via pi", () => {
	let piAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-coa-${nextId()}`);
		// Agent dir must be <temp>/.pi/agent so dirname = <temp>/.pi
		piAgentDir = path.join(piAgentDir, ".pi", "agent");
		makeExtensionsDir(piAgentDir);

		await installViaRegistry(piAgentDir, pkgName, registrySrc, repoRoot);
	});

	it("symlink in pi agent dir", () => {
		const extDir = getExtensionsDirFor(piAgentDir);
		expect(isSymlinked(extDir, pkgName)).toBe(true);
	});

	it("extension directory contains package.json with pi.extensions", () => {
		const extDir = getExtensionsDirFor(piAgentDir);
		const pkgJsonPath = path.join(extDir, "pi-co-author", "package.json");
		expect(existsSync(pkgJsonPath)).toBe(true);

		const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		expect(pkgJson.pi).toBeDefined();
		expect(pkgJson.pi.extensions).toBeDefined();
	});

	it("pi loads without errors", async () => {
		const result = await loadViaPi(piAgentDir);
		expect(result.extensionsResult.errors).toHaveLength(0);
	});
});
