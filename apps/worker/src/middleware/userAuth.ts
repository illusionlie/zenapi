import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { sha256Hex } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { getBearerToken } from "../utils/request";

export type UserRecord = {
	id: string;
	email: string;
	name: string;
	role: string;
	balance: number;
	status: string;
	linuxdo_id?: string;
	linuxdo_username?: string;
	/** Raw JSON string array; null/undefined = no model restriction. */
	allowed_models?: string | null;
};

/**
 * Validates user session tokens for user-facing APIs.
 */
export const userAuth = createMiddleware<AppEnv>(async (c, next) => {
	const token = getBearerToken(c);
	if (!token) {
		return jsonError(c, 401, "user_token_required", "user_token_required");
	}

	const tokenHash = await sha256Hex(token);
	const session = await c.env.DB.prepare(
		"SELECT id, user_id, expires_at FROM user_sessions WHERE token_hash = ?",
	)
		.bind(tokenHash)
		.first<{ id: string; user_id: string; expires_at: string }>();

	if (!session) {
		return jsonError(c, 401, "invalid_user_token", "invalid_user_token");
	}

	if (new Date(String(session.expires_at)).getTime() <= Date.now()) {
		await c.env.DB.prepare("DELETE FROM user_sessions WHERE id = ?")
			.bind(String(session.id))
			.run();
		return jsonError(c, 401, "user_session_expired", "user_session_expired");
	}

	const user = await c.env.DB.prepare(
		"SELECT id, email, name, role, balance, status, linuxdo_id, linuxdo_username, allowed_models FROM users WHERE id = ?",
	)
		.bind(session.user_id)
		.first<UserRecord>();

	if (!user) {
		return jsonError(c, 401, "user_not_found", "user_not_found");
	}

	if (user.status !== "active") {
		return jsonError(c, 403, "user_disabled", "user_disabled");
	}

	c.set("userId", user.id);
	c.set("userRecord", user);
	await next();
});
