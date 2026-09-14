import type { D1Database } from "@cloudflare/workers-types";
import { safeJsonParse } from "./json";

export const PROXY_EXTRA_HEADERS_KEY = "proxy_extra_headers";
export const PROXY_REMOVE_HEADERS_KEY = "proxy_remove_headers";

export type ProxyHeaderPolicy = {
	extraHeaders: Record<string, string>;
	removeHeaders: string[];
};

/**
 * Validates and parses the global extra-headers JSON ({"Name": "Value"},
 * all values must be strings). Empty/missing input counts as an empty
 * config and returns {}; structurally invalid JSON returns null.
 * Shared by the read side (fail-open) and the PUT validation (fail-closed).
 */
export function parseExtraHeaders(
	raw: string | null | undefined,
): Record<string, string> | null {
	if (raw === null || raw === undefined || raw === "") {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value !== "string") {
			return null;
		}
		result[key] = value;
	}
	return result;
}

/**
 * Validates and parses the remove-headers JSON (string array).
 * Empty/missing input counts as an empty config and returns [];
 * structurally invalid JSON returns null.
 */
export function parseRemoveHeaders(
	raw: string | null | undefined,
): string[] | null {
	if (raw === null || raw === undefined || raw === "") {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) {
		return null;
	}
	const result: string[] = [];
	for (const entry of parsed) {
		if (typeof entry !== "string") {
			return null;
		}
		result.push(entry);
	}
	return result;
}

/**
 * Loads the two proxy header settings and merges them into a policy.
 * Single SQL query with both keys bound; malformed stored values are
 * treated as empty config (fail-open) so proxy requests never break.
 */
export async function loadProxyHeaderPolicy(
	db: D1Database,
): Promise<ProxyHeaderPolicy> {
	const result = await db
		.prepare("SELECT key, value FROM settings WHERE key IN (?, ?)")
		.bind(PROXY_EXTRA_HEADERS_KEY, PROXY_REMOVE_HEADERS_KEY)
		.all<{ key: string; value: string | null }>();
	let extraHeaders: Record<string, string> = {};
	let removeHeaders: string[] = [];
	for (const row of result.results ?? []) {
		if (row.key === PROXY_EXTRA_HEADERS_KEY) {
			extraHeaders = parseExtraHeaders(row.value) ?? {};
		} else if (row.key === PROXY_REMOVE_HEADERS_KEY) {
			removeHeaders = parseRemoveHeaders(row.value) ?? [];
		}
	}
	return { extraHeaders, removeHeaders };
}

/**
 * Applies the header policy to an upstream request Headers object in a
 * fixed order: remove (client pass-through) → global inject → channel-level
 * custom headers. Later appliers win, so channel-level overrides global,
 * and global overrides built-in headers (Authorization / x-api-key / ...).
 * With policy === null both global steps are skipped (Playground exemption)
 * while channel-level headers still apply.
 */
export function applyHeaderPolicy(
	headers: Headers,
	policy: ProxyHeaderPolicy | null,
	channelCustomJson: string | null | undefined,
): void {
	if (policy) {
		for (const name of policy.removeHeaders) {
			headers.delete(name);
		}
		for (const [key, value] of Object.entries(policy.extraHeaders)) {
			headers.set(key, value);
		}
	}
	if (channelCustomJson) {
		const customHeaders = safeJsonParse<Record<string, unknown>>(
			channelCustomJson,
			{},
		);
		for (const [key, value] of Object.entries(customHeaders)) {
			headers.set(key, String(value));
		}
	}
}
