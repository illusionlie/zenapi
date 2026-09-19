import type { Context } from "hono";
import type { AppEnv } from "../env";
import { jsonError } from "../utils/http";
import { getTurnstileConfig } from "./settings";

const SITEVERIFY_URL =
	"https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type TurnstileVerifyResult = {
	ok: boolean;
	/** true = siteverify 基建不可用（异常/超时/非 2xx/坏响应体），按 fail-open 放行 */
	degraded?: boolean;
	/** Cloudflare 返回的 error-codes（仅显式 success=false 时出现） */
	codes?: string[];
};

/**
 * True when the TURNSTILE_DISABLED env escape hatch is set to a truthy value
 * ("1" / "true" / "yes", case-insensitive).
 */
export function isTurnstileEnvDisabled(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Effective enforcement decision (pure). Read-side lenient per the global
 * fail-open contract: any missing key / dirty value / env kill switch means
 * "not enforced" — only an explicit, fully-configured, non-disabled state
 * turns verification on.
 */
export function isTurnstileEnforced(
	config: { enabled: boolean; siteKey: string; secretKey: string },
	turnstileDisabledEnv?: string,
): boolean {
	return (
		config.enabled &&
		config.siteKey !== "" &&
		config.secretKey !== "" &&
		!isTurnstileEnvDisabled(turnstileDisabledEnv)
	);
}

/**
 * Verifies a Turnstile token against the Cloudflare siteverify endpoint.
 * No `remoteip` is sent: Turnstile already embeds strong signal, and passing
 * the caller IP would mis-fire on mobile/CGNAT address drift (this project
 * never collects IPs either).
 *
 * Failure policy: only an explicit `success=false` from a 2xx response is a
 * verification failure. Network errors, 5s timeout, non-2xx and malformed
 * response bodies all degrade to fail-open (ok: true, degraded: true) with a
 * warn log — availability outranks bot-proofing on infrastructure faults.
 */
export async function verifyTurnstileToken(
	secret: string,
	token: string,
	fetchImpl: FetchLike = fetch,
): Promise<TurnstileVerifyResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
	try {
		const res = await fetchImpl(SITEVERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ secret, response: token }),
			signal: controller.signal,
		});
		if (!res.ok) {
			console.warn("[turnstile] siteverify unavailable, fail-open", {
				status: res.status,
			});
			return { ok: true, degraded: true };
		}
		const data = (await res.json().catch(() => null)) as {
			success?: boolean;
			"error-codes"?: string[];
		} | null;
		if (!data || typeof data.success !== "boolean") {
			console.warn("[turnstile] siteverify malformed response, fail-open");
			return { ok: true, degraded: true };
		}
		if (!data.success) {
			return { ok: false, codes: data["error-codes"] ?? [] };
		}
		return { ok: true };
	} catch {
		console.warn("[turnstile] siteverify unavailable, fail-open");
		return { ok: true, degraded: true };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Shared thin shell for the three session-minting endpoints (admin login,
 * user login, user register). Returns a jsonError Response when the request
 * must be rejected, or null when verification is off / passed.
 *
 * NOTE: reads the already-parsed body only — the caller must
 * `await c.req.json()` first, because the body can be read exactly once.
 */
export async function enforceTurnstile(
	c: Context<AppEnv>,
	body: unknown,
): Promise<Response | null> {
	const config = await getTurnstileConfig(c.env.DB);
	if (!isTurnstileEnforced(config, c.env.TURNSTILE_DISABLED)) {
		return null;
	}
	const token =
		typeof body === "object" && body !== null
			? (body as { turnstile_token?: unknown }).turnstile_token
			: undefined;
	if (typeof token !== "string" || token === "") {
		return jsonError(
			c,
			400,
			"turnstile_token_missing",
			"turnstile_token_missing",
		);
	}
	const result = await verifyTurnstileToken(config.secretKey, token);
	if (!result.ok) {
		return jsonError(
			c,
			403,
			"turnstile_verify_failed",
			"turnstile_verify_failed",
		);
	}
	return null;
}
