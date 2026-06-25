import type { SystemAccess } from "../../src/system.js";

/** Declarative description of a synthetic host for tests. */
export interface FakeSpec {
	files?: Record<string, string>; // path -> contents (also implies exists)
	exists?: string[]; // extra paths that exist but have no contents
	accessible?: string[]; // paths for which access() returns true
	env?: Record<string, string>;
	euid?: number;
	exec?: Record<string, string>; // "cmd arg1 arg2" -> stdout
	which?: Record<string, string>; // bin name -> resolved path
}

/** Build a SystemAccess backed entirely by the spec. Tracks call counts for cache tests. */
export function makeFakeSystem(spec: FakeSpec) {
	const calls = { readFile: 0, exec: 0, which: 0 };
	const sys: SystemAccess = {
		readFile(path) {
			calls.readFile++;
			return spec.files?.[path];
		},
		exists(path) {
			return path in (spec.files ?? {}) || (spec.exists ?? []).includes(path);
		},
		access(path, _mode?: number) {
			return (spec.accessible ?? []).includes(path);
		},
		env(name) {
			return spec.env?.[name];
		},
		euid() {
			return spec.euid;
		},
		exec(cmd, args) {
			calls.exec++;
			return spec.exec?.[[cmd, ...args].join(" ")];
		},
		which(bins) {
			calls.which++;
			for (const b of bins) {
				const hit = spec.which?.[b];
				if (hit) return hit;
			}
			return undefined;
		},
	};
	return { sys, calls };
}
