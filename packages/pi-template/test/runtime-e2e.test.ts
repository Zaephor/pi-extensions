/**
 * e2e test for pi-template — install via pi-monorepo-registry, then assert
 * the extension symlink and package.json shape land correctly under the pi
 * runtime's agent dir.
 *
 * pi-template is installed via the registry (not natively).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getExtensionsDirFor,
	installViaRegistry,
	isSymlinked,
	makeExtensionsDir,
	makeTemp,
	nextId,
	resetIds,
} from "../../../shared/test/runtime-helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgName = "pi-template";
const registrySrc = path.resolve(__dirname, "../../pi-monorepo-registry/src/index.ts");
const repoRoot = path.resolve(__dirname, "../../..");

resetIds();

describe("Install pi-template via pi", () => {
	let piAgentDir: string;

	beforeAll(async () => {
		piAgentDir = makeTemp(`pi-tpl-${nextId()}`);
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
		const pkgJsonPath = path.join(extDir, "pi-template", "package.json");
		expect(existsSync(pkgJsonPath)).toBe(true);

		const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		expect(pkgJson.pi).toBeDefined();
		expect(pkgJson.pi.extensions).toBeDefined();
	});
});
