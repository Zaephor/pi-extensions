import { probeCapability } from "./capability.js";
import { probeIdentity } from "./identity.js";
import type { SystemAccess } from "./system.js";
import { probeTooling } from "./tooling.js";
import type { EnvReport, Scope } from "./types.js";

/**
 * Process-lifetime cache. The environment is host-stable for a session, so we
 * probe identity+capability once, and tooling at most once (lazily, when a
 * scope that needs it is first requested).
 */
let cache: EnvReport | undefined;

/** Test-only: clear the cache between cases. */
export function resetCache(): void {
	cache = undefined;
}

function needsTooling(scope: Scope): boolean {
	return scope === "tooling" || scope === "all";
}

/**
 * Returns the cached EnvReport BY REFERENCE — callers must not mutate it.
 * The lazy tooling probe mutates the cached object in place, so a report
 * obtained before a tooling/all scope was first requested will gain a
 * `tooling` field afterward. Consumers should read what they need immediately
 * rather than retaining the reference and assuming `tooling` stays absent.
 */
export function detect(sys: SystemAccess, scope: Scope): EnvReport {
	if (!cache) {
		cache = {
			identity: probeIdentity(sys),
			capability: probeCapability(sys),
		};
	}
	if (needsTooling(scope) && !cache.tooling) {
		cache.tooling = probeTooling(sys);
	}
	return cache;
}
