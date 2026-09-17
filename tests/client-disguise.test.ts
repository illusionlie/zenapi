import { describe, expect, it } from "vitest";
import { buildChannelRequest } from "../apps/worker/src/routes/proxy";
import type { ChannelRecord } from "../apps/worker/src/services/channels";
import {
	injectSystemPromptAnthropic,
	injectSystemPromptOpenAI,
	injectSystemPromptResponses,
	parseDisguiseHeaders,
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
