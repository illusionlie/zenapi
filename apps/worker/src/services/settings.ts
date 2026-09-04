import type { D1Database } from "@cloudflare/workers-types";
import { nowIso } from "../utils/time";

const DEFAULT_LOG_RETENTION_DAYS = 30;
const DEFAULT_SESSION_TTL_HOURS = 12;
const RETENTION_KEY = "log_retention_days";
const SESSION_TTL_KEY = "session_ttl_hours";
const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";

async function readSetting(
	db: D1Database,
	key: string,
): Promise<string | null> {
	const setting = await db
		.prepare("SELECT value FROM settings WHERE key = ?")
		.bind(key)
		.first<{ value?: string }>();
	return setting?.value ? String(setting.value) : null;
}

async function upsertSetting(
	db: D1Database,
	key: string,
	value: string,
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
		)
		.bind(key, value, nowIso())
		.run();
}

function parsePositiveNumber(value: string | null, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isNaN(parsed) && parsed > 0) {
		return parsed;
	}
	return fallback;
}

/**
 * Returns the log retention days from settings or default fallback.
 */
export async function getRetentionDays(db: D1Database): Promise<number> {
	const value = await readSetting(db, RETENTION_KEY);
	return parsePositiveNumber(value, DEFAULT_LOG_RETENTION_DAYS);
}

/**
 * Updates the log retention days setting.
 */
export async function setRetentionDays(
	db: D1Database,
	days: number,
): Promise<void> {
	const value = Math.max(1, Math.floor(days)).toString();
	await upsertSetting(db, RETENTION_KEY, value);
}

/**
 * Returns the session TTL hours from settings or default fallback.
 */
export async function getSessionTtlHours(db: D1Database): Promise<number> {
	const value = await readSetting(db, SESSION_TTL_KEY);
	return parsePositiveNumber(value, DEFAULT_SESSION_TTL_HOURS);
}

/**
 * Updates the session TTL hours setting.
 */
export async function setSessionTtlHours(
	db: D1Database,
	hours: number,
): Promise<void> {
	const value = Math.max(1, Math.floor(hours)).toString();
	await upsertSetting(db, SESSION_TTL_KEY, value);
}

/**
 * Returns the admin password hash.
 */
export async function getAdminPasswordHash(
	db: D1Database,
): Promise<string | null> {
	return readSetting(db, ADMIN_PASSWORD_HASH_KEY);
}

/**
 * Updates the admin password hash.
 */
export async function setAdminPasswordHash(
	db: D1Database,
	hash: string,
): Promise<void> {
	if (!hash) {
		return;
	}
	await upsertSetting(db, ADMIN_PASSWORD_HASH_KEY, hash);
}

/**
 * Returns whether the admin password is set.
 */
export async function isAdminPasswordSet(db: D1Database): Promise<boolean> {
	const hash = await getAdminPasswordHash(db);
	return Boolean(hash);
}

const SITE_MODE_KEY = "site_mode";
export type SiteMode = "personal" | "service" | "shared";
const VALID_SITE_MODES: SiteMode[] = ["personal", "service", "shared"];

const REGISTRATION_MODE_KEY = "registration_mode";
export type RegistrationMode = "open" | "linuxdo_only" | "closed";
const VALID_REGISTRATION_MODES: RegistrationMode[] = [
	"open",
	"linuxdo_only",
	"closed",
];

/**
 * Returns the site mode setting.
 */
export async function getSiteMode(db: D1Database): Promise<SiteMode> {
	const value = await readSetting(db, SITE_MODE_KEY);
	if (value && VALID_SITE_MODES.includes(value as SiteMode)) {
		return value as SiteMode;
	}
	return "personal";
}

/**
 * Updates the site mode setting.
 */
export async function setSiteMode(
	db: D1Database,
	mode: SiteMode,
): Promise<void> {
	if (!VALID_SITE_MODES.includes(mode)) {
		return;
	}
	await upsertSetting(db, SITE_MODE_KEY, mode);
}

/**
 * Returns the registration mode setting.
 */
export async function getRegistrationMode(
	db: D1Database,
): Promise<RegistrationMode> {
	const value = await readSetting(db, REGISTRATION_MODE_KEY);
	if (value && VALID_REGISTRATION_MODES.includes(value as RegistrationMode)) {
		return value as RegistrationMode;
	}
	return "open";
}

/**
 * Updates the registration mode setting.
 */
export async function setRegistrationMode(
	db: D1Database,
	mode: RegistrationMode,
): Promise<void> {
	if (!VALID_REGISTRATION_MODES.includes(mode)) {
		return;
	}
	await upsertSetting(db, REGISTRATION_MODE_KEY, mode);
}

/**
 * Loads generic settings as a key/value map.
 */
export async function listSettings(
	db: D1Database,
): Promise<Record<string, string>> {
	const result = await db.prepare("SELECT key, value FROM settings").all();
	const map: Record<string, string> = {};
	for (const row of result.results ?? []) {
		map[String(row.key)] = String(row.value);
	}
	return map;
}

const CHECKIN_REWARD_KEY = "checkin_reward";
const DEFAULT_CHECKIN_REWARD = 0.5;

/**
 * Returns the check-in reward amount from settings or default fallback.
 */
export async function getCheckinReward(db: D1Database): Promise<number> {
	const value = await readSetting(db, CHECKIN_REWARD_KEY);
	return parsePositiveNumber(value, DEFAULT_CHECKIN_REWARD);
}

/**
 * Updates the check-in reward amount setting.
 */
export async function setCheckinReward(
	db: D1Database,
	amount: number,
): Promise<void> {
	const value = Math.max(0.01, amount).toString();
	await upsertSetting(db, CHECKIN_REWARD_KEY, value);
}

const REQUIRE_INVITE_CODE_KEY = "require_invite_code";

/**
 * Returns whether invite code is required for registration.
 */
export async function getRequireInviteCode(db: D1Database): Promise<boolean> {
	const value = await readSetting(db, REQUIRE_INVITE_CODE_KEY);
	return value === "true";
}

/**
 * Updates the require invite code setting.
 */
export async function setRequireInviteCode(
	db: D1Database,
	required: boolean,
): Promise<void> {
	await upsertSetting(db, REQUIRE_INVITE_CODE_KEY, required ? "true" : "false");
}

// LDC Payment settings
const LDC_PAYMENT_ENABLED_KEY = "ldc_payment_enabled";
const LDC_EPAY_PID_KEY = "ldc_epay_pid";
const LDC_EPAY_KEY_KEY = "ldc_epay_key";
const LDC_EPAY_GATEWAY_KEY = "ldc_epay_gateway";
const LDC_EXCHANGE_RATE_KEY = "ldc_exchange_rate";
const DEFAULT_LDC_EPAY_GATEWAY = "https://credit.linux.do/epay";
const DEFAULT_LDC_EXCHANGE_RATE = 0.1;

export async function getLdcPaymentEnabled(db: D1Database): Promise<boolean> {
	const value = await readSetting(db, LDC_PAYMENT_ENABLED_KEY);
	return value === "true";
}

export async function setLdcPaymentEnabled(
	db: D1Database,
	enabled: boolean,
): Promise<void> {
	await upsertSetting(db, LDC_PAYMENT_ENABLED_KEY, enabled ? "true" : "false");
}

export async function getLdcEpayPid(db: D1Database): Promise<string> {
	const value = await readSetting(db, LDC_EPAY_PID_KEY);
	return value ?? "";
}

export async function setLdcEpayPid(
	db: D1Database,
	pid: string,
): Promise<void> {
	await upsertSetting(db, LDC_EPAY_PID_KEY, pid);
}

export async function getLdcEpayKey(db: D1Database): Promise<string> {
	const value = await readSetting(db, LDC_EPAY_KEY_KEY);
	return value ?? "";
}

export async function setLdcEpayKey(
	db: D1Database,
	key: string,
): Promise<void> {
	await upsertSetting(db, LDC_EPAY_KEY_KEY, key);
}

export async function getLdcEpayGateway(db: D1Database): Promise<string> {
	const value = await readSetting(db, LDC_EPAY_GATEWAY_KEY);
	return value || DEFAULT_LDC_EPAY_GATEWAY;
}

export async function setLdcEpayGateway(
	db: D1Database,
	gateway: string,
): Promise<void> {
	await upsertSetting(db, LDC_EPAY_GATEWAY_KEY, gateway);
}

export async function getLdcExchangeRate(db: D1Database): Promise<number> {
	const value = await readSetting(db, LDC_EXCHANGE_RATE_KEY);
	if (!value) return DEFAULT_LDC_EXCHANGE_RATE;
	const parsed = Number(value);
	if (!Number.isNaN(parsed) && parsed > 0) return parsed;
	return DEFAULT_LDC_EXCHANGE_RATE;
}

export async function setLdcExchangeRate(
	db: D1Database,
	rate: number,
): Promise<void> {
	const value = Math.max(0.001, rate).toString();
	await upsertSetting(db, LDC_EXCHANGE_RATE_KEY, value);
}

// Channel fee settings
const CHANNEL_FEE_ENABLED_KEY = "channel_fee_enabled";

/**
 * Returns whether channel contributor fee collection is enabled.
 */
export async function getChannelFeeEnabled(db: D1Database): Promise<boolean> {
	const value = await readSetting(db, CHANNEL_FEE_ENABLED_KEY);
	return value === "true";
}

/**
 * Updates the channel fee enabled setting.
 */
export async function setChannelFeeEnabled(
	db: D1Database,
	enabled: boolean,
): Promise<void> {
	await upsertSetting(db, CHANNEL_FEE_ENABLED_KEY, enabled ? "true" : "false");
}

// Withdrawal settings
const WITHDRAWAL_ENABLED_KEY = "withdrawal_enabled";
const WITHDRAWAL_FEE_RATE_KEY = "withdrawal_fee_rate";

/**
 * Returns whether balance withdrawal is enabled.
 */
export async function getWithdrawalEnabled(db: D1Database): Promise<boolean> {
	const value = await readSetting(db, WITHDRAWAL_ENABLED_KEY);
	return value === "true";
}

/**
 * Updates the withdrawal enabled setting.
 */
export async function setWithdrawalEnabled(
	db: D1Database,
	enabled: boolean,
): Promise<void> {
	await upsertSetting(db, WITHDRAWAL_ENABLED_KEY, enabled ? "true" : "false");
}

/**
 * Returns the withdrawal fee rate percentage (0-100).
 */
export async function getWithdrawalFeeRate(db: D1Database): Promise<number> {
	const value = await readSetting(db, WITHDRAWAL_FEE_RATE_KEY);
	if (!value) return 0;
	const parsed = Number(value);
	if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 100) return parsed;
	return 0;
}

/**
 * Updates the withdrawal fee rate setting.
 */
export async function setWithdrawalFeeRate(
	db: D1Database,
	rate: number,
): Promise<void> {
	const value = Math.max(0, Math.min(100, rate)).toString();
	await upsertSetting(db, WITHDRAWAL_FEE_RATE_KEY, value);
}

// Default balance for new users
const DEFAULT_BALANCE_KEY = "default_balance";

/**
 * Returns the default balance for new users.
 */
export async function getDefaultBalance(db: D1Database): Promise<number> {
	const value = await readSetting(db, DEFAULT_BALANCE_KEY);
	if (!value) return 0;
	const parsed = Number(value);
	if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
	return 0;
}

/**
 * Updates the default balance for new users.
 */
export async function setDefaultBalance(
	db: D1Database,
	amount: number,
): Promise<void> {
	const value = Math.max(0, amount).toString();
	await upsertSetting(db, DEFAULT_BALANCE_KEY, value);
}

// User channel selection
const USER_CHANNEL_SELECTION_ENABLED_KEY = "user_channel_selection_enabled";

/**
 * Returns whether user channel selection is enabled.
 */
export async function getUserChannelSelectionEnabled(
	db: D1Database,
): Promise<boolean> {
	const value = await readSetting(db, USER_CHANNEL_SELECTION_ENABLED_KEY);
	return value === "true";
}

/**
 * Updates the user channel selection enabled setting.
 */
export async function setUserChannelSelectionEnabled(
	db: D1Database,
	enabled: boolean,
): Promise<void> {
	await upsertSetting(
		db,
		USER_CHANNEL_SELECTION_ENABLED_KEY,
		enabled ? "true" : "false",
	);
}

// Withdrawal mode: "lenient" = consumption deducts welfare first; "strict" = consumption always reduces withdrawable
const WITHDRAWAL_MODE_KEY = "withdrawal_mode";
export type WithdrawalMode = "lenient" | "strict";

/**
 * Returns the withdrawal mode.
 */
export async function getWithdrawalMode(
	db: D1Database,
): Promise<WithdrawalMode> {
	const value = await readSetting(db, WITHDRAWAL_MODE_KEY);
	if (value === "strict") return "strict";
	return "lenient";
}

/**
 * Updates the withdrawal mode.
 */
export async function setWithdrawalMode(
	db: D1Database,
	mode: WithdrawalMode,
): Promise<void> {
	await upsertSetting(db, WITHDRAWAL_MODE_KEY, mode);
}

// Channel review: require admin approval for user-contributed channels
const CHANNEL_REVIEW_ENABLED_KEY = "channel_review_enabled";

/**
 * Returns whether channel contribution review is enabled.
 */
export async function getChannelReviewEnabled(
	db: D1Database,
): Promise<boolean> {
	const value = await readSetting(db, CHANNEL_REVIEW_ENABLED_KEY);
	return value === "true";
}

/**
 * Updates the channel review enabled setting.
 */
export async function setChannelReviewEnabled(
	db: D1Database,
	enabled: boolean,
): Promise<void> {
	await upsertSetting(
		db,
		CHANNEL_REVIEW_ENABLED_KEY,
		enabled ? "true" : "false",
	);
}

// LDOH cookie for syncing public sites
const LDOH_COOKIE_KEY = "ldoh_cookie";

export async function getLdohCookie(db: D1Database): Promise<string> {
	const value = await readSetting(db, LDOH_COOKIE_KEY);
	return value ?? "";
}

export async function setLdohCookie(
	db: D1Database,
	cookie: string,
): Promise<void> {
	await upsertSetting(db, LDOH_COOKIE_KEY, cookie);
}

// Announcement
const ANNOUNCEMENT_KEY = "announcement";

/**
 * Returns the current site announcement text (empty string if not set).
 */
export async function getAnnouncement(db: D1Database): Promise<string> {
	const value = await readSetting(db, ANNOUNCEMENT_KEY);
	return value ?? "";
}

/**
 * Updates the site announcement. Pass empty string to clear.
 */
export async function setAnnouncement(
	db: D1Database,
	text: string,
): Promise<void> {
	await upsertSetting(db, ANNOUNCEMENT_KEY, text);
}
