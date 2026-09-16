import { serializeAllowlist } from "../utils/model-allowlist";

/**
 * Shape of a token row as read from the DB, used as the base for
 * three-state PATCH resolution.
 */
export type ExistingToken = {
	name: string;
	quota_total: number | null;
	quota_used: number;
	status: string;
	allowed_channels: string | null;
	allowed_models: string | null;
};

/** Final column values to write back after a successful update. */
export type TokenUpdateValues = ExistingToken;

/** snake_case error codes aligned with the jsonError convention. */
export type TokenUpdateError =
	| "missing_body"
	| "invalid_name"
	| "invalid_quota"
	| "invalid_status"
	| "invalid_allowed_models";

export type TokenUpdateResult =
	| { ok: true; values: TokenUpdateValues }
	| { ok: false; error: TokenUpdateError };

/**
 * Resolves a PATCH payload against an existing token row (pure function).
 *
 * Three-state semantics per field (design.md D5.2):
 * - `undefined`  → keep the existing value
 * - `null`       → clear (only meaningful for quota_total / allowed_channels /
 *   allowed_models; treated as undefined elsewhere)
 * - concrete value → validate strictly; invalid input is rejected with 400
 *   instead of silently falling back to the old value
 *
 * The body must be a plain object; anything else (null, primitives, arrays)
 * yields `missing_body`.
 */
export function resolveTokenUpdate(
	body: unknown,
	existing: ExistingToken,
): TokenUpdateResult {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false, error: "missing_body" };
	}
	const input = body as Record<string, unknown>;

	let name = existing.name;
	const rawName = input.name;
	if (rawName !== undefined && rawName !== null) {
		if (typeof rawName !== "string" || !rawName.trim()) {
			return { ok: false, error: "invalid_name" };
		}
		name = rawName;
	}

	let quotaTotal = existing.quota_total;
	const rawQuotaTotal = input.quota_total;
	if (rawQuotaTotal === null) {
		// null = clear back to unlimited
		quotaTotal = null;
	} else if (rawQuotaTotal !== undefined) {
		if (
			typeof rawQuotaTotal !== "number" ||
			!Number.isFinite(rawQuotaTotal) ||
			rawQuotaTotal < 0
		) {
			return { ok: false, error: "invalid_quota" };
		}
		quotaTotal = rawQuotaTotal;
	}

	let quotaUsed = existing.quota_used;
	const rawQuotaUsed = input.quota_used;
	if (rawQuotaUsed !== undefined && rawQuotaUsed !== null) {
		if (
			typeof rawQuotaUsed !== "number" ||
			!Number.isInteger(rawQuotaUsed) ||
			rawQuotaUsed < 0
		) {
			return { ok: false, error: "invalid_quota" };
		}
		quotaUsed = rawQuotaUsed;
	}

	let status = existing.status;
	const rawStatus = input.status;
	if (rawStatus !== undefined && rawStatus !== null) {
		if (rawStatus !== "active" && rawStatus !== "disabled") {
			return { ok: false, error: "invalid_status" };
		}
		status = rawStatus;
	}

	let allowedChannels = existing.allowed_channels;
	const rawAllowedChannels = input.allowed_channels;
	if (rawAllowedChannels === null) {
		// null = clear the channel restriction
		allowedChannels = null;
	} else if (rawAllowedChannels !== undefined) {
		// Existing format is passed through as-is (legacy flat array or
		// per-model map); not interpreted here.
		allowedChannels = JSON.stringify(rawAllowedChannels);
	}

	let allowedModels = existing.allowed_models;
	const rawAllowedModels = input.allowed_models;
	if (rawAllowedModels === null) {
		// null = unrestricted
		allowedModels = null;
	} else if (rawAllowedModels !== undefined) {
		const serialized = serializeAllowlist(rawAllowedModels);
		if (!serialized.ok) {
			return { ok: false, error: "invalid_allowed_models" };
		}
		allowedModels = serialized.value;
	}

	return {
		ok: true,
		values: {
			name,
			quota_total: quotaTotal,
			quota_used: quotaUsed,
			status,
			allowed_channels: allowedChannels,
			allowed_models: allowedModels,
		},
	};
}

/**
 * Shape of the token columns the user-facing PATCH endpoint reads and writes
 * (quota / channel columns stay admin-only and are never part of this row).
 */
export type UserExistingToken = {
	name: string;
	status: string;
	allowed_models: string | null;
};

/** Final column values to write back after a successful user-side update. */
export type UserTokenUpdateValues = UserExistingToken;

/** snake_case error codes aligned with the jsonError convention. */
export type UserTokenUpdateError =
	| "missing_body"
	| "invalid_name"
	| "invalid_status"
	| "invalid_allowed_models";

export type UserTokenUpdateResult =
	| { ok: true; values: UserTokenUpdateValues }
	| { ok: false; error: UserTokenUpdateError };

/**
 * Resolves a user-facing PATCH payload against an existing token row (pure
 * function). Users may edit name / status / allowed_models only; quota and
 * channel fields are rejected upstream (`field_not_editable`).
 *
 * Three-state semantics per field, aligned with `resolveTokenUpdate`:
 * - `undefined`  → keep the existing value
 * - `null`       → clear for allowed_models (unrestricted); treated as
 *   undefined for name / status
 * - concrete value → validate strictly; invalid input is rejected with 400
 *   instead of silently falling back to the old value
 *
 * The body must be a plain object; anything else (null, primitives, arrays)
 * yields `missing_body`.
 */
export function resolveUserTokenUpdate(
	body: unknown,
	existing: UserExistingToken,
): UserTokenUpdateResult {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return { ok: false, error: "missing_body" };
	}
	const input = body as Record<string, unknown>;

	let name = existing.name;
	const rawName = input.name;
	if (rawName !== undefined && rawName !== null) {
		if (typeof rawName !== "string" || !rawName.trim()) {
			return { ok: false, error: "invalid_name" };
		}
		name = rawName;
	}

	let status = existing.status;
	const rawStatus = input.status;
	if (rawStatus !== undefined && rawStatus !== null) {
		if (rawStatus !== "active" && rawStatus !== "disabled") {
			return { ok: false, error: "invalid_status" };
		}
		status = rawStatus;
	}

	let allowedModels = existing.allowed_models;
	const rawAllowedModels = input.allowed_models;
	if (rawAllowedModels === null) {
		// null = unrestricted
		allowedModels = null;
	} else if (rawAllowedModels !== undefined) {
		const serialized = serializeAllowlist(rawAllowedModels);
		if (!serialized.ok) {
			return { ok: false, error: "invalid_allowed_models" };
		}
		allowedModels = serialized.value;
	}

	return {
		ok: true,
		values: {
			name,
			status,
			allowed_models: allowedModels,
		},
	};
}
