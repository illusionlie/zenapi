import { Hono } from "hono";
import type { AppEnv } from "../env";
import {
	getAnnouncement,
	getChannelFeeEnabled,
	getChannelReviewEnabled,
	getCheckinReward,
	getDefaultBalance,
	getLdcEpayGateway,
	getLdcEpayKey,
	getLdcEpayPid,
	getLdcExchangeRate,
	getLdcPaymentEnabled,
	getLdohCookie,
	getRegistrationMode,
	getRequireInviteCode,
	getRetentionDays,
	getSessionTtlHours,
	getSiteMode,
	getUserChannelSelectionEnabled,
	getWithdrawalEnabled,
	getWithdrawalFeeRate,
	getWithdrawalMode,
	isAdminPasswordSet,
	type RegistrationMode,
	type SiteMode,
	setAdminPasswordHash,
	setAnnouncement,
	setChannelFeeEnabled,
	setChannelReviewEnabled,
	setCheckinReward,
	setDefaultBalance,
	setLdcEpayGateway,
	setLdcEpayKey,
	setLdcEpayPid,
	setLdcExchangeRate,
	setLdcPaymentEnabled,
	setLdohCookie,
	setRegistrationMode,
	setRequireInviteCode,
	setRetentionDays,
	setSessionTtlHours,
	setSiteMode,
	setUserChannelSelectionEnabled,
	setWithdrawalEnabled,
	setWithdrawalFeeRate,
	setWithdrawalMode,
	type WithdrawalMode,
} from "../services/settings";
import { sha256Hex } from "../utils/crypto";
import { jsonError } from "../utils/http";

const settings = new Hono<AppEnv>();

/**
 * Returns settings values.
 */
settings.get("/", async (c) => {
	const retention = await getRetentionDays(c.env.DB);
	const sessionTtlHours = await getSessionTtlHours(c.env.DB);
	const adminPasswordSet = await isAdminPasswordSet(c.env.DB);
	const siteMode = await getSiteMode(c.env.DB);
	const registrationMode = await getRegistrationMode(c.env.DB);
	const checkinReward = await getCheckinReward(c.env.DB);
	const requireInviteCode = await getRequireInviteCode(c.env.DB);
	const ldcPaymentEnabled = await getLdcPaymentEnabled(c.env.DB);
	const ldcEpayPid = await getLdcEpayPid(c.env.DB);
	const ldcEpayKey = await getLdcEpayKey(c.env.DB);
	const ldcEpayGateway = await getLdcEpayGateway(c.env.DB);
	const ldcExchangeRate = await getLdcExchangeRate(c.env.DB);
	const channelFeeEnabled = await getChannelFeeEnabled(c.env.DB);
	const channelReviewEnabled = await getChannelReviewEnabled(c.env.DB);
	const userChannelSelectionEnabled = await getUserChannelSelectionEnabled(
		c.env.DB,
	);
	const defaultBalance = await getDefaultBalance(c.env.DB);
	const withdrawalEnabled = await getWithdrawalEnabled(c.env.DB);
	const withdrawalFeeRate = await getWithdrawalFeeRate(c.env.DB);
	const withdrawalMode = await getWithdrawalMode(c.env.DB);
	const ldohCookie = await getLdohCookie(c.env.DB);
	const announcement = await getAnnouncement(c.env.DB);
	return c.json({
		log_retention_days: retention,
		session_ttl_hours: sessionTtlHours,
		admin_password_set: adminPasswordSet,
		site_mode: siteMode,
		registration_mode: registrationMode,
		checkin_reward: checkinReward,
		require_invite_code: requireInviteCode,
		ldc_payment_enabled: ldcPaymentEnabled,
		ldc_epay_pid: ldcEpayPid,
		ldc_epay_key: ldcEpayKey,
		ldc_epay_gateway: ldcEpayGateway,
		ldc_exchange_rate: ldcExchangeRate,
		channel_fee_enabled: channelFeeEnabled,
		channel_review_enabled: channelReviewEnabled,
		user_channel_selection_enabled: userChannelSelectionEnabled,
		default_balance: defaultBalance,
		withdrawal_enabled: withdrawalEnabled,
		withdrawal_fee_rate: withdrawalFeeRate,
		withdrawal_mode: withdrawalMode,
		ldoh_cookie: ldohCookie,
		announcement: announcement,
	});
});

/**
 * Updates settings values.
 */
settings.put("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "settings_required", "settings_required");
	}

	let touched = false;

	if (body.log_retention_days !== undefined) {
		const days = Number(body.log_retention_days);
		if (Number.isNaN(days) || days < 1) {
			return jsonError(
				c,
				400,
				"invalid_log_retention_days",
				"invalid_log_retention_days",
			);
		}
		await setRetentionDays(c.env.DB, days);
		touched = true;
	}

	if (body.session_ttl_hours !== undefined) {
		const hours = Number(body.session_ttl_hours);
		if (Number.isNaN(hours) || hours < 1) {
			return jsonError(
				c,
				400,
				"invalid_session_ttl_hours",
				"invalid_session_ttl_hours",
			);
		}
		await setSessionTtlHours(c.env.DB, hours);
		touched = true;
	}

	if (typeof body.admin_password === "string" && body.admin_password.trim()) {
		const hash = await sha256Hex(body.admin_password.trim());
		await setAdminPasswordHash(c.env.DB, hash);
		touched = true;
	}

	if (body.site_mode !== undefined) {
		const validModes: SiteMode[] = ["personal", "service", "shared"];
		if (!validModes.includes(body.site_mode)) {
			return jsonError(c, 400, "invalid_site_mode", "invalid_site_mode");
		}
		await setSiteMode(c.env.DB, body.site_mode);
		touched = true;
	}

	if (body.registration_mode !== undefined) {
		const validModes: RegistrationMode[] = ["open", "linuxdo_only", "closed"];
		if (!validModes.includes(body.registration_mode)) {
			return jsonError(
				c,
				400,
				"invalid_registration_mode",
				"invalid_registration_mode",
			);
		}
		await setRegistrationMode(c.env.DB, body.registration_mode);
		touched = true;
	}

	if (body.checkin_reward !== undefined) {
		const reward = Number(body.checkin_reward);
		if (Number.isNaN(reward) || reward <= 0) {
			return jsonError(
				c,
				400,
				"invalid_checkin_reward",
				"invalid_checkin_reward",
			);
		}
		await setCheckinReward(c.env.DB, reward);
		touched = true;
	}

	if (body.require_invite_code !== undefined) {
		const value =
			body.require_invite_code === true || body.require_invite_code === "true";
		await setRequireInviteCode(c.env.DB, value);
		touched = true;
	}

	if (body.ldc_payment_enabled !== undefined) {
		const value =
			body.ldc_payment_enabled === true || body.ldc_payment_enabled === "true";
		await setLdcPaymentEnabled(c.env.DB, value);
		touched = true;
	}

	if (body.ldc_epay_pid !== undefined) {
		await setLdcEpayPid(c.env.DB, String(body.ldc_epay_pid));
		touched = true;
	}

	if (body.ldc_epay_key !== undefined) {
		await setLdcEpayKey(c.env.DB, String(body.ldc_epay_key));
		touched = true;
	}

	if (body.ldc_epay_gateway !== undefined) {
		await setLdcEpayGateway(c.env.DB, String(body.ldc_epay_gateway));
		touched = true;
	}

	if (body.ldc_exchange_rate !== undefined) {
		const rate = Number(body.ldc_exchange_rate);
		if (Number.isNaN(rate) || rate <= 0) {
			return jsonError(
				c,
				400,
				"invalid_ldc_exchange_rate",
				"invalid_ldc_exchange_rate",
			);
		}
		await setLdcExchangeRate(c.env.DB, rate);
		touched = true;
	}

	if (body.channel_fee_enabled !== undefined) {
		const value =
			body.channel_fee_enabled === true || body.channel_fee_enabled === "true";
		await setChannelFeeEnabled(c.env.DB, value);
		touched = true;
	}

	if (body.channel_review_enabled !== undefined) {
		const value =
			body.channel_review_enabled === true ||
			body.channel_review_enabled === "true";
		await setChannelReviewEnabled(c.env.DB, value);
		touched = true;
	}

	if (body.user_channel_selection_enabled !== undefined) {
		const value =
			body.user_channel_selection_enabled === true ||
			body.user_channel_selection_enabled === "true";
		await setUserChannelSelectionEnabled(c.env.DB, value);
		touched = true;
	}

	if (body.default_balance !== undefined) {
		const amount = Number(body.default_balance);
		if (Number.isNaN(amount) || amount < 0) {
			return jsonError(
				c,
				400,
				"invalid_default_balance",
				"invalid_default_balance",
			);
		}
		await setDefaultBalance(c.env.DB, amount);
		touched = true;
	}

	if (body.withdrawal_enabled !== undefined) {
		const value =
			body.withdrawal_enabled === true || body.withdrawal_enabled === "true";
		await setWithdrawalEnabled(c.env.DB, value);
		touched = true;
	}

	if (body.withdrawal_fee_rate !== undefined) {
		const rate = Number(body.withdrawal_fee_rate);
		if (Number.isNaN(rate) || rate < 0 || rate > 100) {
			return jsonError(
				c,
				400,
				"invalid_withdrawal_fee_rate",
				"invalid_withdrawal_fee_rate",
			);
		}
		await setWithdrawalFeeRate(c.env.DB, rate);
		touched = true;
	}

	if (body.withdrawal_mode !== undefined) {
		const validModes: WithdrawalMode[] = ["lenient", "strict"];
		if (!validModes.includes(body.withdrawal_mode)) {
			return jsonError(
				c,
				400,
				"invalid_withdrawal_mode",
				"invalid_withdrawal_mode",
			);
		}
		await setWithdrawalMode(c.env.DB, body.withdrawal_mode);
		touched = true;
	}

	if (body.ldoh_cookie !== undefined) {
		await setLdohCookie(c.env.DB, String(body.ldoh_cookie));
		touched = true;
	}

	if (body.announcement !== undefined) {
		await setAnnouncement(c.env.DB, String(body.announcement));
		touched = true;
	}

	if (!touched) {
		return jsonError(c, 400, "settings_empty", "settings_empty");
	}

	return c.json({ ok: true });
});

export default settings;
