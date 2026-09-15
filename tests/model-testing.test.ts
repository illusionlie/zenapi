import { describe, expect, it } from "vitest";
import {
	buildModelTestRequestBody,
	MODEL_TEST_DEFAULT_PROMPT,
	MODEL_TEST_TIMEOUT_MS,
	parseModelTestResponse,
} from "../apps/worker/src/services/model-testing";

function jsonResponse(body: string, status: number): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("MODEL_TEST constants", () => {
	it("pins the 30s timeout and a non-empty default prompt", () => {
		expect(MODEL_TEST_TIMEOUT_MS).toBe(30_000);
		expect(MODEL_TEST_DEFAULT_PROMPT.length).toBeGreaterThan(0);
	});
});

describe("buildModelTestRequestBody", () => {
	it("builds a single-turn non-stream chat body", () => {
		const { bodyText, parsedBody } = buildModelTestRequestBody(
			"gpt-test",
			"hi",
		);
		expect(parsedBody).toEqual({
			model: "gpt-test",
			messages: [{ role: "user", content: "hi" }],
			stream: false,
		});
		expect(bodyText).toBe(JSON.stringify(parsedBody));
	});

	it("omits max_tokens / max_completion_tokens / stream_options", () => {
		const { parsedBody } = buildModelTestRequestBody("m", "t");
		expect(parsedBody).not.toHaveProperty("max_tokens");
		expect(parsedBody).not.toHaveProperty("max_completion_tokens");
		expect(parsedBody).not.toHaveProperty("stream_options");
	});
});

describe("parseModelTestResponse", () => {
	it("extracts choices[0].message.content from an openai success body", async () => {
		const response = jsonResponse(
			JSON.stringify({
				id: "chatcmpl-1",
				choices: [{ index: 0, message: { role: "assistant", content: "OK" } }],
			}),
			200,
		);
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: true,
			content: "OK",
		});
	});

	it("treats 2xx JSON without choices as success with a raw excerpt", async () => {
		const raw = JSON.stringify({ hello: "world" });
		const response = jsonResponse(raw, 200);
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: true,
			content: raw,
		});
	});

	it("treats 2xx non-JSON bodies as success with a raw excerpt", async () => {
		const response = new Response("plain pong", { status: 200 });
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: true,
			content: "plain pong",
		});
	});

	it("falls back to the raw body when choices content is empty", async () => {
		const raw = JSON.stringify({
			choices: [{ message: { role: "assistant", content: "" } }],
		});
		const response = jsonResponse(raw, 200);
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: true,
			content: raw,
		});
	});

	it("reports non-2xx as failure with status and body excerpt", async () => {
		const response = jsonResponse(
			JSON.stringify({ error: { message: "bad key" } }),
			401,
		);
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: false,
			error: 'HTTP 401: {"error":{"message":"bad key"}}',
		});
	});

	it("reports non-JSON non-2xx bodies as failure too", async () => {
		const response = new Response("upstream exploded", { status: 500 });
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: false,
			error: "HTTP 500: upstream exploded",
		});
	});

	it("truncates success content to 200 chars", async () => {
		const response = jsonResponse(
			JSON.stringify({ choices: [{ message: { content: "x".repeat(500) } }] }),
			200,
		);
		const outcome = await parseModelTestResponse(response);
		expect(outcome).toEqual({ ok: true, content: "x".repeat(200) });
	});

	it("keeps exactly-200-char content untruncated", async () => {
		const exact = "y".repeat(200);
		const response = jsonResponse(
			JSON.stringify({ choices: [{ message: { content: exact } }] }),
			200,
		);
		const outcome = await parseModelTestResponse(response);
		expect(outcome).toEqual({ ok: true, content: exact });
	});

	it("truncates error body excerpts to 200 chars after the status prefix", async () => {
		const response = new Response("e".repeat(500), { status: 502 });
		await expect(parseModelTestResponse(response)).resolves.toEqual({
			ok: false,
			error: `HTTP 502: ${"e".repeat(200)}`,
		});
	});
});
