import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { UserRecord } from "../middleware/userAuth";
import { userAuth } from "../middleware/userAuth";
import {
	getLdcEpayGateway,
	getLdcEpayKey,
	getLdcEpayPid,
	getLdcExchangeRate,
	getWithdrawalEnabled,
	getWithdrawalFeeRate,
} from "../services/settings";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";

const withdrawal = new Hono<AppEnv>();

/**
 * POST /create — create a withdrawal order and distribute LDC.
 */
withdrawal.post("/create", userAuth, async (c) => {
	const userId = c.get("userId") as string;
	const user = c.get("userRecord") as UserRecord;
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const enabled = await getWithdrawalEnabled(c.env.DB);
	if (!enabled) {
		return jsonError(c, 403, "withdrawal_disabled", "withdrawal_disabled");
	}

	if (!user.linuxdo_id || !user.linuxdo_username) {
		return jsonError(c, 400, "linuxdo_required", "linuxdo_required");
	}

	const amount = Number(body.amount);
	if (!amount || amount <= 0) {
		return jsonError(c, 400, "invalid_amount", "invalid_amount");
	}
	// Check ≤ 2 decimal places
	const parts = String(body.amount).split(".");
	if (parts.length > 1 && parts[1].length > 2) {
		return jsonError(c, 400, "invalid_amount", "amount_max_2_decimals");
	}

	// Refresh user balances from DB
	const freshUser = await c.env.DB.prepare(
		"SELECT balance, withdrawable_balance FROM users WHERE id = ?",
	)
		.bind(userId)
		.first<{ balance: number; withdrawable_balance: number }>();

	if (!freshUser) {
		return jsonError(c, 404, "user_not_found", "user_not_found");
	}

	if (amount > freshUser.withdrawable_balance) {
		return jsonError(
			c,
			400,
			"insufficient_withdrawable",
			"insufficient_withdrawable",
		);
	}
	if (amount > freshUser.balance) {
		return jsonError(c, 400, "insufficient_balance", "insufficient_balance");
	}

	const pid = await getLdcEpayPid(c.env.DB);
	const key = await getLdcEpayKey(c.env.DB);
	const gateway = await getLdcEpayGateway(c.env.DB);
	const exchangeRate = await getLdcExchangeRate(c.env.DB);
	const feeRate = await getWithdrawalFeeRate(c.env.DB);

	if (!pid || !key) {
		return jsonError(
			c,
			500,
			"ldc_payment_not_configured",
			"ldc_payment_not_configured",
		);
	}

	// Calculate LDC amounts
	const grossLdc = Math.round((amount / exchangeRate) * 100) / 100;
	const feeAmount = Math.round(grossLdc * (feeRate / 100) * 100) / 100;
	const netLdc = Math.round((grossLdc - feeAmount) * 100) / 100;

	if (netLdc <= 0) {
		return jsonError(c, 400, "amount_too_small", "amount_too_small");
	}

	const now = Date.now();
	const random = Math.random().toString(36).slice(2, 8);
	const outTradeNo = `ZENW-${now}-${random}`;
	const id = crypto.randomUUID();
	const nowStr = nowIso();

	// Deduct balance and withdrawable_balance with guards
	const deductResult = await c.env.DB.prepare(
		"UPDATE users SET balance = balance - ?, withdrawable_balance = withdrawable_balance - ?, updated_at = ? WHERE id = ? AND balance >= ? AND withdrawable_balance >= ?",
	)
		.bind(amount, amount, nowStr, userId, amount, amount)
		.run();

	if (!deductResult.meta?.changes || deductResult.meta.changes === 0) {
		return jsonError(c, 400, "insufficient_balance", "insufficient_balance");
	}

	// Insert order as pending
	await c.env.DB.prepare(
		"INSERT INTO withdrawal_orders (id, user_id, out_trade_no, balance_amount, ldc_amount, fee_amount, fee_rate, linuxdo_id, linuxdo_username, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
	)
		.bind(
			id,
			userId,
			outTradeNo,
			amount,
			netLdc,
			feeAmount,
			feeRate,
			user.linuxdo_id,
			user.linuxdo_username,
			nowStr,
			nowStr,
		)
		.run();

	// Call distribute API
	try {
		const distributeUrl = `${gateway.replace(/\/+$/, "")}/pay/distribute`;
		const authHeader = `Basic ${btoa(`${pid}:${key}`)}`;

		const resp = await fetch(distributeUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: authHeader,
			},
			body: JSON.stringify({
				user_id: Number(user.linuxdo_id),
				username: user.linuxdo_username,
				amount: netLdc,
				out_trade_no: outTradeNo,
				remark: "ZenAPI 提现",
			}),
		});

		if (resp.ok) {
			// Mark as completed
			await c.env.DB.prepare(
				"UPDATE withdrawal_orders SET status = 'completed', updated_at = ? WHERE id = ?",
			)
				.bind(nowIso(), id)
				.run();

			return c.json({
				ok: true,
				order_id: id,
				balance_amount: amount,
				ldc_amount: netLdc,
				fee_amount: feeAmount,
			});
		}

		// Distribute failed — refund and mark failed
		let errorMsg = "distribute_failed";
		try {
			const errText = await resp.text();
			errorMsg = errText.slice(0, 512);
		} catch {
			// ignore
		}

		await c.env.DB.prepare(
			"UPDATE users SET balance = balance + ?, withdrawable_balance = withdrawable_balance + ?, updated_at = ? WHERE id = ?",
		)
			.bind(amount, amount, nowIso(), userId)
			.run();

		await c.env.DB.prepare(
			"UPDATE withdrawal_orders SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
		)
			.bind(errorMsg, nowIso(), id)
			.run();

		return jsonError(c, 502, "distribute_failed", errorMsg);
	} catch (err) {
		// Network error — refund and mark failed
		const errorMsg = err instanceof Error ? err.message : "network_error";

		await c.env.DB.prepare(
			"UPDATE users SET balance = balance + ?, withdrawable_balance = withdrawable_balance + ?, updated_at = ? WHERE id = ?",
		)
			.bind(amount, amount, nowIso(), userId)
			.run();

		await c.env.DB.prepare(
			"UPDATE withdrawal_orders SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
		)
			.bind(errorMsg, nowIso(), id)
			.run();

		return jsonError(c, 502, "gateway_unreachable", "gateway_unreachable");
	}
});

/**
 * GET /orders — list recent withdrawal orders.
 */
withdrawal.get("/orders", userAuth, async (c) => {
	const userId = c.get("userId") as string;

	const result = await c.env.DB.prepare(
		"SELECT id, out_trade_no, balance_amount, ldc_amount, fee_amount, fee_rate, status, error_message, created_at FROM withdrawal_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
	)
		.bind(userId)
		.all();

	return c.json({ orders: result.results ?? [] });
});

export default withdrawal;
