/**
 * Persistence — load and save registry state to disk.
 *
 * State is stored as JSON at ~/.<agent>/monorepo/state.json
 * Path resolution is centralized in paths.ts — this module just reads/writes.
 *
 * The RegistryState shape includes `installedPackages` (added in M006).
 * Older state files that lack this field are migrated automatically.
 *
 * Crash safety:
 *   - Writes are atomic (temp file + rename) — never a truncated state file.
 *   - Before each write, the previous state.json is copied to a PID-scoped
 *     backup file (state.json.bak.<pid>.<rand>). No fixed-name collisions.
 *   - If state.json is corrupted/truncated on read, ALL backup files in the
 *     directory are tried newest-first until one parses.
 *   - Old backups from dead processes are pruned on each save.
 *
 * Concurrency safety:
 *   - Advisory file locking via mkdir (atomic on POSIX) with retry + backoff.
 *   - Prevents TOCTOU races when multiple sandboxes share ~/.gsd or ~/.pi.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getStateFilePath } from "./paths.js";
import type { InstalledPackage, MonorepoSource, RegistryState } from "./types.js";

// --------------- Constants ---------------

/** Max attempts to acquire the advisory lock. */
const LOCK_MAX_ATTEMPTS = 10;

/** Base delay in ms between lock attempts (doubles each retry). */
const LOCK_BASE_DELAY_MS = 50;

/** Max age in ms before a stale lock is considered abandoned and force-released. */
const LOCK_STALE_AGE_MS = 10_000; // 10 seconds

/** Max backup files to keep (oldest pruned on each save). */
const MAX_BACKUPS = 5;

/** Glob-like prefix for backup files: state.json.bak */
const BACKUP_PREFIX = "state.json.bak";

// --------------- Helpers ---------------

/** Monotonic counter to guarantee unique, ordered suffixes within a process. */
let _suffixCounter = 0;

/** Generate a unique suffix: timestamp.counter.pid.random — counter breaks same-ms ties. */
function uniqueSuffix(): string {
	return `${Date.now()}.${++_suffixCounter}.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
}

// --------------- Advisory lock (mkdir-based) ---------------

/**
 * Get the lock directory path for a given state file.
 * Uses mkdir which is atomic on POSIX — either it succeeds (lock acquired) or fails (lock held).
 */
function lockPathFor(filePath: string): string {
	return `${filePath}.lock`;
}

/**
 * Try to acquire an advisory lock via mkdir.
 * Returns true if the lock was acquired, false otherwise.
 */
function tryAcquireLock(lockDir: string): boolean {
	try {
		mkdirSync(lockDir, { recursive: false });
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a lock directory is stale (older than LOCK_STALE_AGE_MS).
 * Stale locks happen when a process crashes while holding the lock.
 */
function isLockStale(lockDir: string): boolean {
	try {
		const { mtimeMs } = statSync(lockDir);
		return Date.now() - mtimeMs > LOCK_STALE_AGE_MS;
	} catch {
		return false; // Can't stat — lock might have just been released
	}
}

/**
 * Release an advisory lock by removing the lock directory.
 */
function releaseLock(lockDir: string): void {
	try {
		rmSync(lockDir, { force: true, recursive: true });
	} catch {
		// Best effort — lock dir might already be gone
	}
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire an advisory lock with exponential backoff.
 * Cleans up stale locks left by crashed processes.
 *
 * @throws Error if the lock cannot be acquired after max attempts.
 */
async function acquireLock(filePath: string): Promise<string> {
	const lockDir = lockPathFor(filePath);

	for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
		if (tryAcquireLock(lockDir)) {
			return lockDir;
		}

		// Check for stale lock from a crashed process
		if (isLockStale(lockDir)) {
			releaseLock(lockDir);
			// Immediately try again — no sleep needed
			if (tryAcquireLock(lockDir)) {
				return lockDir;
			}
		}

		// Exponential backoff: 50ms, 100ms, 200ms, ...
		await sleep(LOCK_BASE_DELAY_MS * 2 ** attempt);
	}

	throw new Error(
		`[monorepo-registry] Could not acquire lock on ${filePath} after ${LOCK_MAX_ATTEMPTS} attempts. ` +
			`Another process may be stuck. Delete ${lockDir} manually if needed.`,
	);
}

// --------------- Backup management ---------------

/**
 * Create a PID-scoped backup of the current state file before overwriting.
 * Each process gets its own backup — no collision risk across sandboxes.
 * Best-effort — ignores errors if the file doesn't exist yet.
 */
function createBackup(filePath: string): void {
	if (!existsSync(filePath)) return;
	const dir = dirname(filePath);
	const backupPath = join(dir, `${BACKUP_PREFIX}.${uniqueSuffix()}`);
	try {
		copyFileSync(filePath, backupPath);
	} catch {
		// Best effort — backup failure should not block writes
	}
}

/**
 * Find all backup files for the state file, sorted newest-first.
 * Backup names embed timestamp.pid.rand, so lexicographic DESC = newest-first.
 * Returns absolute paths.
 */
function findBackups(filePath: string): string[] {
	const dir = dirname(filePath);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}

	// Filter to state.json.bak.<timestamp>.<pid>.<rand> — must have at least 3 dot-separated parts after prefix
	return entries
		.filter((e) => e.startsWith(BACKUP_PREFIX) && e.length > BACKUP_PREFIX.length)
		.sort((a, b) => b.localeCompare(a)) // DESC = newest-first (names start with timestamp)
		.map((e) => join(dir, e));
}

/**
 * Prune old backup files, keeping only the newest MAX_BACKUPS.
 * Called on each save to prevent unbounded backup growth.
 */
function pruneBackups(filePath: string): void {
	const all = findBackups(filePath);
	if (all.length <= MAX_BACKUPS) return;

	for (const old of all.slice(MAX_BACKUPS)) {
		try {
			rmSync(old, { force: true });
		} catch {
			// Best effort
		}
	}
}

/**
 * Remove any leftover temp files from crashed writes.
 * Matches: .state.json.tmp.<timestamp>.<rand>
 */
function cleanStaleTemps(filePath: string): void {
	const dir = dirname(filePath);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}

	const base = ".state.json.tmp.";
	for (const e of entries) {
		if (e.startsWith(base)) {
			try {
				rmSync(join(dir, e), { force: true });
			} catch {
				// Best effort
			}
		}
	}
}

// --------------- State parsing ---------------

/** Check if a parsed source object has the minimum required fields. */
function isValidSource(s: unknown): s is Record<string, unknown> {
	return typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).url === "string";
}

/** Check if a parsed installedPackage object has the minimum required fields. */
function isValidInstalledPackage(p: unknown): p is Record<string, unknown> {
	if (typeof p !== "object" || p === null) return false;
	const obj = p as Record<string, unknown>;
	return typeof obj.name === "string" && typeof obj.targetPath === "string";
}

/**
 * Parse raw JSON string into a RegistryState.
 * Returns null if the data is not valid registry state.
 */
function parseState(raw: string): RegistryState | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	// Basic shape validation
	if (!parsed || !Array.isArray((parsed as Record<string, unknown>).sources)) {
		return null;
	}

	const parsedObj = parsed as Record<string, unknown>;

	// Ensure each source has required fields (migrate older state)
	const sources: MonorepoSource[] = (parsedObj.sources as unknown[])
		.filter(isValidSource)
		.map((s: Record<string, unknown>) => ({
			url: s.url as string,
			shortName: (s.shortName as string) || "",
			packagesRoot: (s.packagesRoot as string) || "packages",
			packages: Array.isArray(s.packages) ? s.packages : [],
			lastUpdated: (s.lastUpdated as string) || new Date().toISOString(),
			rootPath: (s.rootPath as string) || (s.url as string),
		}));

	// Migrate installedPackages — default to empty array for older state files
	const installedPackages: InstalledPackage[] = Array.isArray(parsedObj.installedPackages)
		? ((parsedObj.installedPackages as unknown[]).filter(isValidInstalledPackage) as unknown as InstalledPackage[])
		: [];

	return { sources, installedPackages };
}

// --------------- Public API ---------------

/**
 * Load registry state from disk.
 *
 * Recovery strategy:
 *   1. Try to read and parse state.json
 *   2. On failure (truncated, corrupted), scan for PID-scoped backup files
 *      (state.json.bak.*) sorted newest-first and try each
 *   3. If a backup parses, restore state.json from it
 *   4. Return empty state only if no state file ever existed
 *
 * Uses advisory locking to prevent reading a partially-written file.
 */
export async function loadState(): Promise<RegistryState> {
	const filePath = getStateFilePath();
	const backups = findBackups(filePath);

	// No state file at all and no backups — legitimate empty state (first run)
	if (!existsSync(filePath) && backups.length === 0) {
		return { sources: [], installedPackages: [] };
	}

	// Try to read primary state file (with lock to avoid reading mid-write)
	let lockDir: string | undefined;
	try {
		lockDir = await acquireLock(filePath);
	} catch {
		// Lock acquisition failed — proceed without lock (read-only, low risk)
	}

	try {
		if (existsSync(filePath)) {
			try {
				const raw = await readFile(filePath, "utf-8");
				const state = parseState(raw);
				if (state) {
					return state;
				}
				// Primary file is corrupted — try backups
				console.warn(
					`[monorepo-registry] state.json is corrupted or invalid, scanning ${backups.length} backup(s) for recovery`,
				);
			} catch (err) {
				console.warn(
					`[monorepo-registry] Failed to read state.json: ${err instanceof Error ? err.message : String(err)}, scanning backups`,
				);
			}
		}

		// Try backups newest-first (re-read in case new ones appeared)
		const currentBackups = findBackups(filePath);
		for (const backupPath of currentBackups) {
			try {
				const raw = await readFile(backupPath, "utf-8");
				const state = parseState(raw);
				if (state) {
					console.warn(
						`[monorepo-registry] Recovered state from backup ${backupPath} (${state.sources.length} sources, ${state.installedPackages.length} packages). Restoring state.json.`,
					);
					// Restore primary from backup so next read succeeds normally
					try {
						const dir = dirname(filePath);
						mkdirSync(dir, { recursive: true });
						copyFileSync(backupPath, filePath);
					} catch {
						// Best effort restore
					}
					return state;
				}
			} catch {
				// Try next backup
			}
		}

		// Nothing is readable — return empty state as last resort
		console.warn(
			`[monorepo-registry] state.json and all ${currentBackups.length} backup(s) are corrupted. Returning empty state.`,
		);
		return { sources: [], installedPackages: [] };
	} finally {
		if (lockDir) {
			releaseLock(lockDir);
		}
	}
}

/**
 * Save registry state to disk atomically.
 *
 * Write sequence:
 *   1. Acquire advisory lock
 *   2. Clean up stale temp files from previous crashed writes
 *   3. Create PID-scoped backup of existing state.json
 *   4. Write to PID-scoped temp file
 *   5. Atomic rename temp → state.json
 *   6. Prune old backups (keep newest MAX_BACKUPS)
 *   7. Release lock
 *
 * This ensures:
 *   - No truncated state file on crash (atomic rename)
 *   - Per-process backup files — no collision across sandboxes
 *   - Automatic cleanup of old backups and stale temps
 *   - No TOCTOU race with concurrent processes (advisory lock)
 */
export async function saveState(state: RegistryState): Promise<void> {
	const filePath = getStateFilePath();
	const dir = dirname(filePath);

	// Ensure directory exists synchronously (mkdir -p)
	mkdirSync(dir, { recursive: true });

	// Serialize — strip non-essential fields from packages to keep file small
	const serializable = {
		sources: state.sources.map((source) => ({
			url: source.url,
			shortName: source.shortName,
			packagesRoot: source.packagesRoot,
			packages: source.packages.map((pkg) => ({
				name: pkg.name,
				description: pkg.description,
				version: pkg.version,
				path: pkg.path,
				isPiPackage: pkg.isPiPackage,
			})),
			lastUpdated: source.lastUpdated,
			rootPath: source.rootPath,
		})),
		installedPackages: state.installedPackages.map((pkg) => ({
			name: pkg.name,
			sourceUrl: pkg.sourceUrl,
			activationMode: pkg.activationMode,
			installedAt: pkg.installedAt,
			targetPath: pkg.targetPath,
			extensionDir: pkg.extensionDir,
		})),
	};

	const json = JSON.stringify(serializable, null, "\t");

	// Acquire advisory lock
	const lockDir = await acquireLock(filePath);

	try {
		// Clean up any leftover temp files from crashed writes
		cleanStaleTemps(filePath);

		// Backup existing file before overwriting (PID-scoped, no collision)
		createBackup(filePath);

		// Write to PID-scoped temp file, then atomic rename
		const tmpPath = join(dir, `.state.json.tmp.${uniqueSuffix()}`);
		await writeFile(tmpPath, json, "utf-8");
		await rename(tmpPath, filePath);

		// Prune old backups
		pruneBackups(filePath);
	} finally {
		releaseLock(lockDir);
	}
}
