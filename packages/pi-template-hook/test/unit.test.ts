import { describe, expect, it } from "vitest";
import { redact } from "../src/index.js";

describe("redact()", () => {
	it("leaves clean commands unchanged", () => {
		const r = redact("ls -la /tmp");
		expect(r.command).toBe("ls -la /tmp");
		expect(r.changed).toBe(false);
	});

	it("redacts --token=<value>", () => {
		const r = redact("curl --token=secret123 https://example.com");
		expect(r.command).toBe("curl --token=<redacted> https://example.com");
		expect(r.changed).toBe(true);
	});

	it("redacts --api-key= and --api-key <space-separated>", () => {
		const r1 = redact("curl --api-key=abc");
		const r2 = redact("curl --api-key xyz");
		expect(r1.command).toBe("curl --api-key=<redacted>");
		expect(r2.command).toBe("curl --api-key=<redacted>");
	});

	it("redacts AWS_SECRET* env assignments", () => {
		const r = redact("AWS_SECRET_ACCESS_KEY=abc123 aws s3 ls");
		expect(r.command).toBe("AWS_SECRET=<redacted> aws s3 ls");
		expect(r.changed).toBe(true);
	});

	it("redacts GH_TOKEN= env assignments", () => {
		const r = redact("GH_TOKEN=ghp_xxx gh api /user");
		expect(r.command).toBe("GH_TOKEN=<redacted> gh api /user");
	});

	it("applies multiple redactions in one command", () => {
		const r = redact("GH_TOKEN=abc curl --token=xyz https://api.example.com");
		expect(r.command).toBe("GH_TOKEN=<redacted> curl --token=<redacted> https://api.example.com");
		expect(r.changed).toBe(true);
	});

	it("accepts a custom rule set", () => {
		const r = redact("hello world", [{ match: /hello/g, replacement: "GOODBYE" }]);
		expect(r.command).toBe("GOODBYE world");
		expect(r.changed).toBe(true);
	});

	it("returns changed=false when custom rules don't match", () => {
		const r = redact("hello world", [{ match: /xyzzy/g, replacement: "X" }]);
		expect(r.changed).toBe(false);
	});
});
