import { safeJsonParse } from "./json";

/**
 * Parses the raw `users.allowed_models` column value (JSON string array)
 * into a string list. Accepts the raw DB TEXT value or an already-parsed value.
 *
 * Malformed input fails open (returns null = unrestricted), consistent with
 * the existing `safeJsonParse` / `tokens.allowed_channels` pattern:
 * null/undefined/empty string, invalid JSON, non-array JSON, arrays containing
 * non-string elements, and empty (or all-empty) arrays all yield null.
 */
export function parseAllowlist(raw: unknown): string[] | null {
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		parsed = safeJsonParse<unknown>(raw, null);
	}
	if (!Array.isArray(parsed)) {
		return null;
	}
	const items: string[] = [];
	for (const item of parsed) {
		if (typeof item !== "string") {
			return null;
		}
		const trimmed = item.trim();
		if (trimmed) {
			items.push(trimmed);
		}
	}
	return items.length > 0 ? items : null;
}

/**
 * Whether `model` may be called under the given user-level allowlist.
 *
 * Semantics (design.md D2):
 * - Null/empty allowlist → unrestricted (true).
 * - Missing model name → cannot be judged → true (same lenient behavior as
 *   model-less requests skipping `model_not_found` checks).
 * - Otherwise: exact, case-sensitive match on the requested model name
 *   (the client-sent `body.model` original text, before alias resolution).
 */
export function isModelAllowed(
	allowlist: string[] | null | undefined,
	model: string | null | undefined,
): boolean {
	if (!allowlist || allowlist.length === 0) {
		return true;
	}
	if (!model) {
		return true;
	}
	return allowlist.includes(model);
}

/**
 * Whether `model` may be called under ALL of the given allowlists.
 *
 * Each list is checked independently with `isModelAllowed` semantics
 * (null/empty = unrestricted). The lists are deliberately NOT merged into an
 * intersection array: two disjoint allowlists (e.g. token limits `gpt-4o`,
 * user limits `claude-3`) would intersect to an empty array, which
 * `isModelAllowed` treats as unrestricted (fail-open) — a security
 * inversion. Independent per-list checks keep each list's
 * fail-open/fail-closed behavior intact.
 */
export function isModelAllowedByAll(
	allowlists: (string[] | null | undefined)[],
	model: string | null | undefined,
): boolean {
	return allowlists.every((list) => isModelAllowed(list, model));
}

/**
 * Validates and serializes an `allowed_models`-style payload into the JSON
 * string stored in a DB TEXT column (`users.allowed_models` /
 * `tokens.allowed_models`).
 * - null / [] → null (unrestricted)
 * - array of non-empty strings → JSON string
 * - anything else (non-array, non-string or whitespace-only element) → invalid
 */
export function serializeAllowlist(
	input: unknown,
): { ok: true; value: string | null } | { ok: false } {
	if (input === null) {
		return { ok: true, value: null };
	}
	if (!Array.isArray(input)) {
		return { ok: false };
	}
	const models: string[] = [];
	for (const item of input) {
		if (typeof item !== "string") {
			return { ok: false };
		}
		const trimmed = item.trim();
		if (!trimmed) {
			return { ok: false };
		}
		models.push(trimmed);
	}
	if (models.length === 0) {
		return { ok: true, value: null };
	}
	return { ok: true, value: JSON.stringify(models) };
}

/**
 * Filters entries by the allowlist on their `id` (callable model name).
 * Null/empty allowlist returns the input array unchanged.
 */
export function filterModelsByAllowlist<T extends { id: string }>(
	items: T[],
	allowlist: string[] | null | undefined,
): T[] {
	if (!allowlist || allowlist.length === 0) {
		return items;
	}
	const allowed = new Set(allowlist);
	return items.filter((item) => allowed.has(item.id));
}
