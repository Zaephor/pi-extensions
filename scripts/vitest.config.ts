import { defineConfig } from "vitest/config";

// Scripts tests share mutable filesystem state (tsconfig.json, manifest)
// and must run in a single fork to avoid race conditions between test files.
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["scripts/test/**/*.test.ts"],
		exclude: ["**/node_modules/**", "tmp/**"],
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
	},
});
