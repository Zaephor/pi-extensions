#!/usr/bin/env node

/**
 * create-extension — Scaffold a new pi extension package by copying a
 * starter template and renaming.
 *
 * Usage:
 *   node scripts/create-extension.js <name>
 *   node scripts/create-extension.js <name> --template <template-name>
 *
 * Templates available (must exist as a packages/<template-name>/ directory):
 *   - pi-template            (default; 1 tool + 1 command + session_start)
 *   - pi-template-stateful   (state persistence via tool result details)
 *   - pi-template-hook       (tool_call interceptor + audit entry)
 *
 * The chosen template's files are copied verbatim into packages/<name>/,
 * with the template name substring-replaced by the new extension name in
 * every text file. Tool/command identifiers inside src/index.ts are left
 * intact; rename them by hand after scaffolding to match your extension's
 * domain.
 *
 * Root configs (tsconfig.json, release-please-config.json,
 * .release-please-manifest.json, package.json scripts) are updated
 * atomically; partial output is cleaned up on failure.
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const packagesDir = resolve(rootDir, "packages");

const DEFAULT_TEMPLATE = "pi-template";

/** Files we never copy into the new package. */
const EXCLUDED_BASENAMES = new Set(["node_modules", "dist", "CHANGELOG.md"]);
const EXCLUDED_SUFFIXES = [".tsbuildinfo", ".tgz"];

/** Text extensions whose contents are eligible for substring replacement. */
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".json", ".md", ".yml", ".yaml", ".sh"]);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse argv into { name, template } or print usage and exit.
 * Supports: node create-extension.js <name> [--template <name>]
 */
function parseArgs(argv) {
	const args = argv.slice(2);
	let name;
	let template = DEFAULT_TEMPLATE;

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--template") {
			template = args[++i];
			if (!template) {
				return { error: "--template requires a value." };
			}
		} else if (a.startsWith("--template=")) {
			template = a.slice("--template=".length);
		} else if (a.startsWith("--")) {
			return { error: `Unknown flag: ${a}` };
		} else if (!name) {
			name = a;
		} else {
			return { error: `Unexpected positional argument: ${a}` };
		}
	}

	if (!name) {
		return { error: "Usage: node scripts/create-extension.js <name> [--template <template-name>]" };
	}
	return { name, template };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** List discoverable template package directories (anything matching pi-template*). */
function listTemplates() {
	if (!existsSync(packagesDir)) return [];
	return readdirSync(packagesDir)
		.filter((d) => d.startsWith("pi-template"))
		.filter((d) => statSync(join(packagesDir, d)).isDirectory())
		.sort();
}

/**
 * Validate the extension name: non-empty, valid npm package name segment,
 * not a reserved template name, target dir must not exist yet.
 */
function validateName(name) {
	if (!name || name.trim().length === 0) {
		return "Extension name is required.";
	}
	if (/^[._]/.test(name)) {
		return 'Extension name must not start with "." or "_".';
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		return "Extension name must be lowercase alphanumeric with hyphens (e.g. my-tool).";
	}
	if (listTemplates().includes(name)) {
		return `Cannot use reserved template name "${name}".`;
	}
	if (existsSync(resolve(packagesDir, name))) {
		return `Directory packages/${name}/ already exists.`;
	}
	return null;
}

/** Validate the chosen template exists on disk. */
function validateTemplate(template) {
	const dir = resolve(packagesDir, template);
	if (!existsSync(dir) || !statSync(dir).isDirectory()) {
		return `Template "${template}" not found. Available: ${listTemplates().join(", ") || "(none)"}.`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Copy + substitute
// ---------------------------------------------------------------------------

/** Whether a basename should be skipped during copy. */
function isExcluded(basename) {
	if (EXCLUDED_BASENAMES.has(basename)) return true;
	for (const suffix of EXCLUDED_SUFFIXES) {
		if (basename.endsWith(suffix)) return true;
	}
	return false;
}

/** True for files whose contents we want to rewrite via substring replace. */
function isTextFile(filename) {
	const dot = filename.lastIndexOf(".");
	if (dot < 0) return false;
	return TEXT_EXTENSIONS.has(filename.slice(dot));
}

/**
 * Recursively copy `srcDir` to `destDir`. For text files, replace every
 * occurrence of `templateName` with `newName`. Binary files (or files
 * without a recognised text extension) are copied verbatim.
 */
function copyTree(srcDir, destDir, templateName, newName) {
	mkdirSync(destDir, { recursive: true });
	for (const entry of readdirSync(srcDir)) {
		if (isExcluded(entry)) continue;
		const srcPath = join(srcDir, entry);
		const destPath = join(destDir, entry);
		const s = statSync(srcPath);
		if (s.isDirectory()) {
			copyTree(srcPath, destPath, templateName, newName);
		} else if (s.isFile()) {
			if (isTextFile(entry)) {
				const content = readFileSync(srcPath, "utf-8");
				const rewritten = content.split(templateName).join(newName);
				writeFileSync(destPath, rewritten, "utf-8");
			} else {
				copyFileSync(srcPath, destPath);
			}
			console.log(`Creating ${destPath}`);
		}
	}
}

// ---------------------------------------------------------------------------
// JSON helpers — atomic write + retry on read
// ---------------------------------------------------------------------------

function readJsonWithRetry(filePath, retries = 5, delayMs = 50) {
	for (let i = 0; i < retries; i++) {
		try {
			const content = readFileSync(filePath, "utf-8").trim();
			if (!content.startsWith("{") && !content.startsWith("[")) {
				throw new Error(`File does not start with valid JSON: ${content.slice(0, 40)}`);
			}
			return JSON.parse(content);
		} catch (err) {
			if (i === retries - 1) throw err;
			const end = Date.now() + delayMs;
			while (Date.now() < end) {}
		}
	}
}

function writeJsonAtomic(filePath, data) {
	const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	writeFileSync(tmpPath, `${JSON.stringify(data, null, "\t")}\n`, "utf-8");
	renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Root config updaters
// ---------------------------------------------------------------------------

function updateRootTsconfig(name) {
	const tsconfigPath = resolve(rootDir, "tsconfig.json");
	const tsconfig = readJsonWithRetry(tsconfigPath);
	const ref = { path: `packages/${name}` };
	if (!tsconfig.references.some((r) => r.path === ref.path)) {
		tsconfig.references.push(ref);
	}
	writeJsonAtomic(tsconfigPath, tsconfig);
	console.log(`Updated tsconfig.json with packages/${name} reference`);
}

function updateReleaseManifest(name) {
	const manifestPath = resolve(rootDir, ".release-please-manifest.json");
	const manifest = readJsonWithRetry(manifestPath);
	manifest[`packages/${name}`] = "0.0.0";
	writeJsonAtomic(manifestPath, manifest);
	console.log(`Updated .release-please-manifest.json with packages/${name}`);

	const configPath = resolve(rootDir, "release-please-config.json");
	const config = readJsonWithRetry(configPath);
	if (!config.packages) config.packages = {};
	config.packages[`packages/${name}`] = { "release-type": "node", "changelog-type": "default" };
	writeJsonAtomic(configPath, config);
	console.log(`Updated release-please-config.json with packages/${name}`);
}

function updateRootPackageJson() {
	const pkgPath = resolve(rootDir, "package.json");
	const pkg = readJsonWithRetry(pkgPath);
	if (!pkg.scripts["create-extension"]) {
		pkg.scripts["create-extension"] = "node scripts/create-extension.js";
	}
	writeJsonAtomic(pkgPath, pkg);
	console.log('Updated package.json with "create-extension" script');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	const parsed = parseArgs(process.argv);
	if (parsed.error) {
		console.error(parsed.error);
		process.exit(1);
	}
	const { name, template } = parsed;

	const nameError = validateName(name);
	if (nameError) {
		console.error(nameError);
		process.exit(1);
	}

	const templateError = validateTemplate(template);
	if (templateError) {
		console.error(templateError);
		process.exit(1);
	}

	const srcDir = resolve(packagesDir, template);
	const destDir = resolve(packagesDir, name);

	try {
		console.log(`Scaffolding "${name}" from template "${template}"...`);
		copyTree(srcDir, destDir, template, name);

		updateRootTsconfig(name);
		updateReleaseManifest(name);
		updateRootPackageJson();

		console.log(`\nExtension ${name} created from ${template}.`);
		console.log(`   Directory: packages/${name}/`);
		console.log("   Next: rename the tool/command identifiers inside src/index.ts to match your domain,");
		console.log("   then run npm install + npm run check:all from the repo root.");
	} catch (err) {
		console.error(`\nFailed to create extension: ${err.message}`);
		if (existsSync(destDir)) {
			console.error(`Cleaning up packages/${name}/...`);
			rmSync(destDir, { recursive: true, force: true });
		}
		process.exit(1);
	}
}

main();
