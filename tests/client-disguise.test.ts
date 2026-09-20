import { describe, expect, it } from "vitest";
import { buildChannelRequest } from "../apps/worker/src/routes/proxy";
import type { ChannelRecord } from "../apps/worker/src/services/channels";
import {
	genOpencodeRequestId,
	genOpencodeSessionId,
	injectSystemPromptAnthropic,
	injectSystemPromptOpenAI,
	injectSystemPromptResponses,
	parseDisguiseHeaders,
	resolveDisguiseTemplate,
} from "../apps/worker/src/utils/client-disguise";

const PROMPT = "DISGUISE-PROMPT";

function makeChannel(
	overrides: Partial<ChannelRecord> & Pick<ChannelRecord, "api_format">,
): ChannelRecord {
	return {
		id: "ch1",
		name: "test-channel",
		base_url: "https://upstream.example/v1",
		api_key: "sk-channel",
		weight: 1,
		status: "active",
		...overrides,
	};
}

describe("parseDisguiseHeaders", () => {
	it("parses a valid JSON object; empty/missing input is empty config", () => {
		expect(parseDisguiseHeaders('{"User-Agent":"cli/1"}')).toEqual({
			"User-Agent": "cli/1",
		});
		expect(parseDisguiseHeaders("")).toEqual({});
		expect(parseDisguiseHeaders(null)).toEqual({});
		expect(parseDisguiseHeaders(undefined)).toEqual({});
	});

	it("treats malformed / non-object JSON as empty config (fail-open, AC7)", () => {
		expect(parseDisguiseHeaders("{")).toEqual({});
		expect(parseDisguiseHeaders("not-json")).toEqual({});
		expect(parseDisguiseHeaders("42")).toEqual({});
		expect(parseDisguiseHeaders('"str"')).toEqual({});
		expect(parseDisguiseHeaders('["a"]')).toEqual({});
		expect(parseDisguiseHeaders("null")).toEqual({});
	});

	it("treats non-string values as invalid config (same rules as global extra headers)", () => {
		expect(parseDisguiseHeaders('{"a":1}')).toEqual({});
		expect(parseDisguiseHeaders('{"a":null}')).toEqual({});
		expect(parseDisguiseHeaders('{"a":{"b":"c"}}')).toEqual({});
	});
});

describe("injectSystemPromptOpenAI", () => {
	it("prepends the disguise system message ahead of existing messages without mutating the caller's array", () => {
		const original = [{ role: "user", content: "hi" }];
		const body: Record<string, unknown> = { model: "m", messages: original };
		injectSystemPromptOpenAI(body, PROMPT);
		expect(body.messages).toEqual([
			{ role: "system", content: PROMPT },
			{ role: "user", content: "hi" },
		]);
		// caller-owned array untouched (shared parsed body across retries)
		expect(original).toHaveLength(1);
	});

	it("creates messages when missing or non-array", () => {
		const body: Record<string, unknown> = { model: "m" };
		injectSystemPromptOpenAI(body, PROMPT);
		expect(body.messages).toEqual([{ role: "system", content: PROMPT }]);

		const weird: Record<string, unknown> = { messages: "not-an-array" };
		injectSystemPromptOpenAI(weird, PROMPT);
		expect(weird.messages).toEqual([{ role: "system", content: PROMPT }]);
	});

	it("no-ops on an empty prompt (zero regression)", () => {
		const original = [{ role: "user", content: "hi" }];
		const body: Record<string, unknown> = { model: "m", messages: original };
		const before = JSON.stringify(body);
		injectSystemPromptOpenAI(body, "");
		expect(JSON.stringify(body)).toBe(before);
	});
});

describe("injectSystemPromptAnthropic", () => {
	it("sets a string system when unset / null / empty", () => {
		const unset: Record<string, unknown> = {};
		injectSystemPromptAnthropic(unset, PROMPT);
		expect(unset.system).toBe(PROMPT);

		const nullish: Record<string, unknown> = { system: null };
		injectSystemPromptAnthropic(nullish, PROMPT);
		expect(nullish.system).toBe(PROMPT);

		const empty: Record<string, unknown> = { system: "" };
		injectSystemPromptAnthropic(empty, PROMPT);
		expect(empty.system).toBe(PROMPT);
	});

	it("concats ahead of an existing string system", () => {
		const body: Record<string, unknown> = { system: "be nice" };
		injectSystemPromptAnthropic(body, PROMPT);
		expect(body.system).toBe(`${PROMPT}\n\nbe nice`);
	});

	it("prepends a text block ahead of blocks and keeps original cache_control", () => {
		const originalBlock = {
			type: "text",
			text: "be nice",
			cache_control: { type: "ephemeral" },
		};
		const original = [originalBlock];
		const body: Record<string, unknown> = { system: original };
		injectSystemPromptAnthropic(body, PROMPT);
		expect(body.system).toEqual([
			{ type: "text", text: PROMPT },
			originalBlock,
		]);
		// original array untouched (no in-place unshift → no retry leak)
		expect(original).toHaveLength(1);
		expect(originalBlock.cache_control).toEqual({ type: "ephemeral" });
	});

	it("leaves unknown system shapes untouched and no-ops on empty prompt", () => {
		const body: Record<string, unknown> = { system: 42 };
		injectSystemPromptAnthropic(body, PROMPT);
		expect(body.system).toBe(42);

		const empty: Record<string, unknown> = { system: "keep" };
		injectSystemPromptAnthropic(empty, "");
		expect(empty.system).toBe("keep");
	});
});

describe("injectSystemPromptResponses", () => {
	it("sets instructions when unset or empty", () => {
		const unset: Record<string, unknown> = {};
		injectSystemPromptResponses(unset, PROMPT);
		expect(unset.instructions).toBe(PROMPT);

		const empty: Record<string, unknown> = { instructions: "" };
		injectSystemPromptResponses(empty, PROMPT);
		expect(empty.instructions).toBe(PROMPT);
	});

	it("prefixes an existing instructions string", () => {
		const body: Record<string, unknown> = { instructions: "be nice" };
		injectSystemPromptResponses(body, PROMPT);
		expect(body.instructions).toBe(`${PROMPT}\n\nbe nice`);
	});

	it("no-ops on an empty prompt", () => {
		const body: Record<string, unknown> = { instructions: "keep" };
		injectSystemPromptResponses(body, "");
		expect(body.instructions).toBe("keep");
	});
});

describe("buildChannelRequest disguise wiring (design §3.1)", () => {
	it("#1 openai chat: system lands first, caller body never mutated, no retry accumulation", () => {
		const channel = makeChannel({
			api_format: "openai",
			disguise_headers_json: '{"User-Agent":"disguise-cli/1"}',
		});
		const parsedBody: Record<string, unknown> = {
			model: "m",
			messages: [{ role: "user", content: "hi" }],
		};
		const requestText = JSON.stringify(parsedBody);

		const first = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers({ "content-type": "application/json" }),
			requestText,
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const second = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			requestText,
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);

		const parsed = JSON.parse(first.body as string) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(parsed.messages).toHaveLength(2);
		expect(parsed.messages[0]).toEqual({ role: "system", content: PROMPT });
		expect(parsed.messages[1]).toEqual({ role: "user", content: "hi" });
		// same input → byte-identical body (no duplicate prompt injection)
		expect(second.body).toBe(first.body);
		// caller's parsed body stays pristine
		expect(
			(parsedBody.messages as unknown[]).length,
		).toBe(1);
		// disguise header applied even with policy = null (Playground / test semantics)
		expect(first.headers.get("user-agent")).toBe("disguise-cli/1");
	});

	it("#1 openai non-chat body (no messages array) passes through untouched", () => {
		const channel = makeChannel({ api_format: "openai" });
		const parsedBody: Record<string, unknown> = {
			model: "embedding-1",
			input: "hello",
		};
		const requestText = JSON.stringify(parsedBody);
		const { body } = buildChannelRequest(
			channel,
			"/v1/embeddings",
			"",
			new Headers(),
			requestText,
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		expect(body).toBe(requestText);
	});

	it("#2 anthropic: converted body gets prefixed system + disguise headers", () => {
		const channel = makeChannel({
			api_format: "anthropic",
			disguise_headers_json: '{"User-Agent":"disguise-cli/1"}',
		});
		const parsedBody: Record<string, unknown> = {
			model: "m",
			messages: [
				{ role: "system", content: "be nice" },
				{ role: "user", content: "hi" },
			],
		};
		const { body, headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const parsed = JSON.parse(body as string) as {
			system?: string;
			messages: Array<{ role: string; content: string }>;
		};
		expect(parsed.system).toBe(`${PROMPT}\n\nbe nice`);
		expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
		expect(headers.get("user-agent")).toBe("disguise-cli/1");
	});

	it("#1b openai target + /v1/responses inbound: prompt lands in the converted chat messages (design §3.1 post-conversion pattern)", () => {
		const channel = makeChannel({ api_format: "openai" });
		const parsedBody: Record<string, unknown> = {
			model: "m",
			input: "hi",
		};
		const { body } = buildChannelRequest(
			channel,
			"/v1/responses",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const parsed = JSON.parse(body as string) as {
			messages: Array<{ role: string; content: string }>;
			input?: unknown;
		};
		expect(parsed.messages).toEqual([
			{ role: "system", content: PROMPT },
			{ role: "user", content: "hi" },
		]);
		// Responses-only fields do not survive the conversion
		expect(parsed.input).toBeUndefined();
		// caller's parsed body stays pristine
		expect(parsedBody.input).toBe("hi");
	});

	it("#3 responses chat inbound: instructions prefixed", () => {
		const channel = makeChannel({ api_format: "responses" });
		const parsedBody: Record<string, unknown> = {
			model: "m",
			messages: [
				{ role: "system", content: "be nice" },
				{ role: "user", content: "hi" },
			],
		};
		const { body } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const parsed = JSON.parse(body as string) as { instructions?: string };
		expect(parsed.instructions).toBe(`${PROMPT}\n\nbe nice`);
	});

	it("#4 responses /v1/responses passthrough: instructions injected on a copy, model preserved", () => {
		const channel = makeChannel({ api_format: "responses" });
		const parsedBody: Record<string, unknown> = {
			model: "m",
			input: [{ type: "message", role: "user", content: "hi" }],
			instructions: "orig",
		};
		const requestText = JSON.stringify(parsedBody);
		const { body } = buildChannelRequest(
			channel,
			"/v1/responses",
			"",
			new Headers(),
			requestText,
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const parsed = JSON.parse(body as string) as {
			model: string;
			instructions?: string;
			input: unknown[];
		};
		expect(parsed.instructions).toBe(`${PROMPT}\n\norig`);
		expect(parsed.model).toBe("m");
		expect(parsed.input).toEqual(parsedBody.input);
		// caller's parsed body not mutated (still the original value, R4 pristine)
		expect(parsedBody.instructions).toBe("orig");
	});

	it("#4 responses passthrough without prompt stays byte-identical (zero regression)", () => {
		const channel = makeChannel({ api_format: "responses" });
		const parsedBody: Record<string, unknown> = {
			model: "m",
			input: [{ type: "message", role: "user", content: "hi" }],
		};
		const requestText = JSON.stringify(parsedBody);
		const { body } = buildChannelRequest(
			channel,
			"/v1/responses",
			"",
			new Headers(),
			requestText,
			parsedBody,
			false,
			"sk-call",
		);
		expect(body).toBe(requestText);
	});

	it("#5 custom: body byte-identical, disguise headers only", () => {
		const channel = makeChannel({
			api_format: "custom",
			base_url: "https://upstream.example/endpoint",
			disguise_headers_json: '{"User-Agent":"disguise-cli/1"}',
		});
		const requestText = "raw-custom-payload";
		const { body, headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			requestText,
			{ messages: [{ role: "user", content: "hi" }] },
			false,
			"sk-call",
			null,
			PROMPT,
		);
		expect(body).toBe(requestText);
		expect(headers.get("user-agent")).toBe("disguise-cli/1");
	});

	it("consecutive builds of the same channel render different template values (design §6-4, AC7)", () => {
		const channel = makeChannel({
			api_format: "openai",
			disguise_headers_json:
				'{"x-opencode-request":"{{opencode_request_id}}","x-opencode-session":"{{opencode_session_id}}"}',
		});
		const parsedBody: Record<string, unknown> = {
			model: "m",
			messages: [{ role: "user", content: "hi" }],
		};
		const first = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const second = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			JSON.stringify(parsedBody),
			parsedBody,
			false,
			"sk-call",
			null,
			PROMPT,
		);
		const firstReq = first.headers.get("x-opencode-request") ?? "";
		const secondReq = second.headers.get("x-opencode-request") ?? "";
		const firstSes = first.headers.get("x-opencode-session") ?? "";
		const secondSes = second.headers.get("x-opencode-session") ?? "";
		// rendered (not literal), format-legal, and fresh per build
		expect(firstReq).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
		expect(firstSes).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
		expect(firstReq).not.toBe(secondReq);
		expect(firstSes).not.toBe(secondSes);
	});

	it("zero-regression baseline: channels without disguise fields behave exactly as before", () => {
		const channel = makeChannel({
			api_format: "openai",
			custom_headers_json: '{"X-Channel":"1"}',
		});
		const parsedBody: Record<string, unknown> = {
			model: "m",
			messages: [{ role: "user", content: "hi" }],
		};
		const requestText = JSON.stringify(parsedBody);
		const { body, headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers({ "content-type": "application/json" }),
			requestText,
			parsedBody,
			false,
			"sk-call",
		);
		expect(body).toBe(requestText);
		expect(headers.get("x-channel")).toBe("1");
		expect(headers.get("user-agent")).toBeNull();
	});
});

// —— 动态头模板：OpenCode ID 生成器 + 占位符解析(design §6-1/6-2) ——

// 12 hex 段 = (ts << 12 | ctr) 的低 48 位:高 5 位被截断,解码需按 2^36 绕回
// 重建(真实上游做新鲜度校验时面对同样的截断,取与当前时刻最近的候选)。
function decodeHexTimestamp(hex: string, desc: boolean, referenceMs: number): number {
	let v = BigInt(`0x${hex}`);
	if (desc) {
		v = ~v & 0xffffffffffffn; // 按位取反回到 48 位二补数原值
	}
	const encoded = v >> 12n; // = ts mod 2^36
	const MOD = 1n << 36n;
	const bucket = BigInt(referenceMs) / MOD;
	let nearestDiff = BigInt(Number.MAX_SAFE_INTEGER);
	let nearest = 0n;
	for (let k = bucket - 1n; k <= bucket + 1n; k++) {
		const candidate = k * MOD + encoded;
		const diff =
			candidate > BigInt(referenceMs)
				? candidate - BigInt(referenceMs)
				: BigInt(referenceMs) - candidate;
		if (diff < nearestDiff) {
			nearestDiff = diff;
			nearest = candidate;
		}
	}
	return Number(nearest);
}

describe("genOpencodeRequestId / genOpencodeSessionId (design §6-1)", () => {
	it("renders msg_/ses_ prefix + 26 chars (12 hex + 14 base62)", () => {
		const msg = genOpencodeRequestId();
		const ses = genOpencodeSessionId();
		expect(msg).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
		expect(ses).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
	});

	it("fixed-now hex bytes match expected packing; ses branch is the bitwise inversion", () => {
		// 黄金值由 research §2 算法(与 sst/opencode src/id/id.ts 逐行一致)独立验算得出
		const now = 1789789694239;
		expect(genOpencodeRequestId(now)).toMatch(/^msg_0b7c7691f001[0-9A-Za-z]{14}$/);
		// ~((now << 12) | 1) 的低 48 位:0b7c7691f001 逐字节取反
		expect(genOpencodeSessionId(now)).toMatch(/^ses_f483896e0ffe[0-9A-Za-z]{14}$/);
	});

	it("hex segment decodes back to the injected now within ±60s (msg direct, ses via inversion)", () => {
		const now = 1789789694239;
		const msg = genOpencodeRequestId(now);
		const ses = genOpencodeSessionId(now);
		const decodedMsg = decodeHexTimestamp(msg.slice(4, 16), false, now);
		const decodedSes = decodeHexTimestamp(ses.slice(4, 16), true, now);
		expect(Math.abs(decodedMsg - now)).toBeLessThanOrEqual(60_000);
		expect(Math.abs(decodedSes - now)).toBeLessThanOrEqual(60_000);
		// 固定 now 注入时重建应精确命中
		expect(decodedMsg).toBe(now);
		expect(decodedSes).toBe(now);
	});

	it("two generations with the same now differ (random segment)", () => {
		const now = 1789789694239;
		expect(genOpencodeRequestId(now)).not.toBe(genOpencodeRequestId(now));
		expect(genOpencodeSessionId(now)).not.toBe(genOpencodeSessionId(now));
	});
});

describe("resolveDisguiseTemplate (design §6-2)", () => {
	it("replaces known placeholders with freshly generated values", () => {
		expect(resolveDisguiseTemplate("{{uuid}}")).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(resolveDisguiseTemplate("ts={{timestamp_ms}}")).toMatch(
			/^ts=\d{13}$/,
		);
		expect(resolveDisguiseTemplate("{{opencode_request_id}}")).toMatch(
			/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/,
		);
		expect(resolveDisguiseTemplate("{{opencode_session_id}}")).toMatch(
			/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/,
		);
	});

	it("generates each occurrence independently within one value", () => {
		const [first, second] = resolveDisguiseTemplate(
			"{{uuid}}|{{uuid}}",
		).split("|");
		expect(first).toMatch(/^[0-9a-f-]{36}$/);
		expect(second).toMatch(/^[0-9a-f-]{36}$/);
		expect(first).not.toBe(second);
	});

	it("keeps unknown placeholders as-is (fail-open)", () => {
		expect(resolveDisguiseTemplate("{{nope}}")).toBe("{{nope}}");
		expect(resolveDisguiseTemplate("Bearer {{nope}} {{uuid}}")).toMatch(
			/^Bearer \{\{nope\}\} [0-9a-f-]{36}$/,
		);
	});

	it("returns values without {{ by the same reference (fast path, zero regression)", () => {
		const literal = "opencode/1.18.31";
		expect(resolveDisguiseTemplate(literal)).toBe(literal);
	});

	it("preserves surrounding text in mixed templates", () => {
		const rendered = resolveDisguiseTemplate(
			"pre-{{timestamp_ms}}-mid-{{opencode_request_id}}-post",
		);
		expect(rendered).toMatch(
			/^pre-\d{13}-mid-msg_[0-9a-f]{12}[0-9A-Za-z]{14}-post$/,
		);
	});
});
