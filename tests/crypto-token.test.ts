import { describe, expect, it } from "vitest";
import { generateToken } from "../apps/worker/src/utils/crypto";

// base64url alphabet: A-Z a-z 0-9 "-" "_"
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

describe("generateToken", () => {
	it("produces a 46-char API token for generateToken(\"sk-\", 32)", () => {
		const token = generateToken("sk-", 32);
		expect(token.length).toBe(46); // "sk-" + 43 base64url chars (32 bytes)
		expect(token.startsWith("sk-")).toBe(true);
		expect(BASE64URL_PATTERN.test(token)).toBe(true);
	});

	it("keeps the legacy 24-byte output for the default call (regression guard)", () => {
		// Sessions / channel IDs / OAuth state / random passwords rely on the
		// default: 24 bytes -> exactly 32 base64url chars (no padding)
		const token = generateToken();
		expect(token.length).toBe(32);
		expect(BASE64URL_PATTERN.test(token)).toBe(true);
	});

	it("keeps the legacy 35-char output when only a prefix is given", () => {
		// Old API-token call shape: "sk-" + 32 chars
		const token = generateToken("sk-");
		expect(token.length).toBe(35);
		expect(token.startsWith("sk-")).toBe(true);
		expect(BASE64URL_PATTERN.test(token)).toBe(true);
	});
});
