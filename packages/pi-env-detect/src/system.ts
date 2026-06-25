import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Re-exported so probe modules can request write access without importing node:fs. */
export const W_OK = constants.W_OK;

/**
 * The single seam between probes and the host. Every probe takes a SystemAccess
 * so tests can inject synthetic environments. The real impl never throws — every
 * method returns a safe "absent" value on error.
 */
export interface SystemAccess {
	/** File contents, or undefined if missing/unreadable. */
	readFile(path: string): string | undefined;
	/** Whether a path exists. */
	exists(path: string): boolean;
	/** Whether a path is accessible for the given fs.constants mode (default R_OK). */
	access(path: string, mode?: number): boolean;
	/** Environment variable value, or undefined. */
	env(name: string): string | undefined;
	/** Effective uid (process.geteuid), or undefined on platforms without it. */
	euid(): number | undefined;
	/** Run a command; undefined if it cannot be spawned or exits non-zero. */
	exec(cmd: string, args: string[]): string | undefined;
	/** Resolve the first of `bins` found on PATH; returns its absolute path or undefined. */
	which(bins: string[]): string | undefined;
}

export function realSystem(): SystemAccess {
	return {
		readFile(path) {
			try {
				return readFileSync(path, "utf8");
			} catch {
				return undefined;
			}
		},
		exists(path) {
			try {
				return existsSync(path);
			} catch {
				return false;
			}
		},
		access(path, mode = constants.R_OK) {
			try {
				accessSync(path, mode);
				return true;
			} catch {
				return false;
			}
		},
		env(name) {
			return process.env[name];
		},
		euid() {
			return typeof process.geteuid === "function" ? process.geteuid() : undefined;
		},
		exec(cmd, args) {
			try {
				const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 2000 });
				if (r.status !== 0 || typeof r.stdout !== "string") return undefined;
				return r.stdout;
			} catch {
				return undefined;
			}
		},
		which(bins) {
			const path = process.env.PATH ?? "";
			for (const dir of path.split(":")) {
				if (!dir) continue;
				for (const bin of bins) {
					const full = join(dir, bin);
					try {
						if (existsSync(full)) return full;
					} catch {
						// keep scanning
					}
				}
			}
			return undefined;
		},
	};
}
