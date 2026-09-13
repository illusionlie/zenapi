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
