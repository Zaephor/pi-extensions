/**
 * Settings — atomic read/write bridge for the agent's settings.json.
 *
 * The agent (pi/gsd) reads `extensions[]` from settings.json on startup.
 * This module lets the registry programmatically add/remove extension paths
 * in that array while preserving ALL other keys in the file.
 *
 * All writes are atomic (temp file + rename) to prevent corruption.
 */

import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getExtensionsDir, getSettingsFilePath } from "./paths.js";

/**
 * Read and parse a settings.json file.
 * Returns `{}` if the file is missing or contains malformed JSON (with a warning).
 */
export async function readSettingsJson(filePath: string): Promise<Record<string, unknown>> {
	if (!existsSync(filePath)) {
		return {};
	}

	try {
		const raw = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		console.warn(`[monorepo-registry] settings.json is not an object at ${filePath}, treating as empty`);
		return {};
	} catch (err) {
		console.warn(`[monorepo-registry] Failed to parse settings.json at ${filePath}: ${err}`);
		return {};
	}
}

/**
 * Atomically write data to a JSON file via temp file + rename.
 * Creates the parent directory if it doesn't exist.
 */
export async function writeSettingsJson(filePath: string, data: Record<string, unknown>): Promise<void> {
	const dir = dirname(filePath);
	const tmpPath = join(dir, `.settings.json.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`);

	// Ensure parent directory exists
	const { mkdirSync } = await import("node:fs");
	mkdirSync(dir, { recursive: true });

	// Write to temp file first
	await writeFile(tmpPath, JSON.stringify(data, null, "\t"), "utf-8");

	// Atomic rename
	await rename(tmpPath, filePath);
}

/**
 * Get the extensions array from a parsed settings object.
 * Returns an empty array if the key is missing or not an array.
 */
function getExtensionsArray(settings: Record<string, unknown>): string[] {
	const ext = settings.extensions;
	if (Array.isArray(ext)) {
		return ext.filter((e): e is string => typeof e === "string");
	}
	return [];
}

/**
 * Register an extension path in settings.json → extensions[].
 * Adds the path if not already present. Preserves all other settings.
 * Uses absolute paths for reliability across working directory changes.
 *
 * @param settingsFilePath - Path to the settings.json file
 * @param extensionsDir - Absolute path to register
 */
export async function registerExtensionPath(settingsFilePath: string, extensionsDir: string): Promise<void> {
	const settings = await readSettingsJson(settingsFilePath);
	const extensions = getExtensionsArray(settings);

	// Use absolute path — normalize to avoid trailing slash mismatches
	const absPath = extensionsDir.replace(/\/+$/, "");

	if (extensions.includes(absPath)) {
		return; // Already registered, idempotent
	}

	settings.extensions = [...extensions, absPath];
	await writeSettingsJson(settingsFilePath, settings);
}

/**
 * Unregister an extension path from settings.json → extensions[].
 * Removes only the specified path. Preserves all other entries and settings.
 *
 * @param settingsFilePath - Path to the settings.json file
 * @param extensionsDir - Absolute path to unregister
 */
export async function unregisterExtensionPath(settingsFilePath: string, extensionsDir: string): Promise<void> {
	const settings = await readSettingsJson(settingsFilePath);
	const extensions = getExtensionsArray(settings);
	const absPath = extensionsDir.replace(/\/+$/, "");

	if (!extensions.includes(absPath)) {
		return; // Not registered, no-op
	}

	settings.extensions = extensions.filter((e) => e !== absPath);
	await writeSettingsJson(settingsFilePath, settings);
}

/**
 * Check if an extension path is registered in settings.json → extensions[].
 *
 * @param settingsFilePath - Path to the settings.json file
 * @param extensionsDir - Absolute path to check
 */
export async function isExtensionRegistered(settingsFilePath: string, extensionsDir: string): Promise<boolean> {
	const settings = await readSettingsJson(settingsFilePath);
	const extensions = getExtensionsArray(settings);
	const absPath = extensionsDir.replace(/\/+$/, "");
	return extensions.includes(absPath);
}

// ---------------------------------------------------------------------------
// Convenience wrappers that use the default agent-scoped paths
// ---------------------------------------------------------------------------

/** Register the monorepo extensions directory in the agent's settings.json. */
export async function registerExtensionsDir(): Promise<void> {
	await registerExtensionPath(getSettingsFilePath(), getExtensionsDir());
}

/** Unregister the monorepo extensions directory from the agent's settings.json. */
export async function unregisterExtensionsDir(): Promise<void> {
	await unregisterExtensionPath(getSettingsFilePath(), getExtensionsDir());
}

/** Check if the monorepo extensions directory is registered. */
export async function isExtensionsDirRegistered(): Promise<boolean> {
	return isExtensionRegistered(getSettingsFilePath(), getExtensionsDir());
}
