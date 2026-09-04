import { Hono } from "hono";
import type { AppEnv } from "../env";
import { sha256Hex } from "../utils/crypto";
import { jsonError } from "../utils/http";
import { nowIso } from "../utils/time";

const adminUsers = new Hono<AppEnv>();

/**
 * Lists all users.
 */
adminUsers.get("/", async (c) => {
	const result = await c.env.DB.prepare(
		"SELECT id, email, name, role, balance, status, created_at, updated_at FROM users ORDER BY created_at DESC",
	).all();
	return c.json({ users: result.results ?? [] });
});

/**
 * Creates a new user (admin-created).
 */
adminUsers.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	if (!body?.email || !body?.name || !body?.password) {
		return jsonError(
			c,
			400,
			"missing_fields",
			"email, name, password required",
		);
	}

	const email = String(body.email).trim().toLowerCase();
	const name = String(body.name).trim();
	const password = String(body.password);

	const existing = await c.env.DB.prepare(
		"SELECT id FROM users WHERE email = ? OR LOWER(name) = ?",
	)
		.bind(email, name.toLowerCase())
		.first();

	if (existing) {
		return jsonError(c, 409, "email_or_name_exists", "email_or_name_exists");
	}

	const id = crypto.randomUUID();
	const passwordHash = await sha256Hex(password);
	const now = nowIso();
	const balance = Number(body.balance ?? 0);

	await c.env.DB.prepare(
		"INSERT INTO users (id, email, name, password_hash, role, balance, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(
			id,
			email,
			name,
			passwordHash,
			body.role ?? "user",
			balance,
			"active",
			now,
			now,
		)
		.run();

	return c.json({
		id,
		email,
		name,
		role: body.role ?? "user",
		balance,
		status: "active",
	});
});

/**
 * Updates a user (balance, status, name, etc).
 */
adminUsers.patch("/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	if (!body) {
		return jsonError(c, 400, "missing_body", "missing_body");
	}

	const existing = await c.env.DB.prepare(
		"SELECT id, email, name, role, balance, status FROM users WHERE id = ?",
	)
		.bind(id)
		.first<{
			id: string;
			email: string;
			name: string;
			role: string;
			balance: number;
			status: string;
		}>();

	if (!existing) {
		return jsonError(c, 404, "user_not_found", "user_not_found");
	}

	const now = nowIso();
	const newBalance =
		body.balance !== undefined ? Number(body.balance) : existing.balance;

	await c.env.DB.prepare(
		"UPDATE users SET name = ?, role = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?",
	)
		.bind(
			body.name ?? existing.name,
			body.role ?? existing.role,
			Number.isNaN(newBalance) ? existing.balance : newBalance,
			body.status ?? existing.status,
			now,
			id,
		)
		.run();

	// If password is provided, update it
	if (body.password) {
		const passwordHash = await sha256Hex(String(body.password));
		await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
			.bind(passwordHash, id)
			.run();
	}

	return c.json({ ok: true });
});

/**
 * Deletes a user and their sessions.
 */
adminUsers.delete("/:id", async (c) => {
	const id = c.req.param("id");

	await c.env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?")
		.bind(id)
		.run();
	await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();

	return c.json({ ok: true });
});

export default adminUsers;
