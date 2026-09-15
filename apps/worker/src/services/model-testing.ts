/**
 * Channel model testing — pure request/response logic for the
 * POST /api/channels/test-model route. No Context / D1 dependencies so the
 * helpers stay unit-testable (tests/model-testing.test.ts).
 */

export const MODEL_TEST_TIMEOUT_MS = 30_000;
export const MODEL_TEST_DEFAULT_PROMPT = "你好，请直接回复 OK 以确认服务可用。";

const MODEL_TEST_EXCERPT_MAX_CHARS = 200;

/**
 * Outcome of a single model test round-trip.
 */
export type ModelTestOutcome =
	| { ok: true; content: string }
	| { ok: false; error: string };

function truncateExcerpt(text: string): string {
	return text.length <= MODEL_TEST_EXCERPT_MAX_CHARS
		? text
		: text.slice(0, MODEL_TEST_EXCERPT_MAX_CHARS);
}

/**
 * Builds the non-stream chat completion body used for model testing.
 * Deliberately omits max_tokens and stream_options: some reasoning models
 * reject max_tokens (they require max_completion_tokens), and usage
 * injection is pointless for a manual one-shot test (PRD Constraints).
 */
export function buildModelTestRequestBody(
	model: string,
	text: string,
): { bodyText: string; parsedBody: Record<string, unknown> } {
	const parsedBody: Record<string, unknown> = {
		model,
		messages: [{ role: "user", content: text }],
		stream: false,
	};
	return { bodyText: JSON.stringify(parsedBody), parsedBody };
}

/**
 * Classifies a (non-stream) upstream response for the model test.
 * - 2xx always counts as success: custom-format upstreams may return any
 *   shape, so strong choices validation would produce false negatives.
 *   The parsed reply text (choices[0].message.content) is preferred;
 *   otherwise the raw body is returned as a truncated excerpt.
 * - Non-2xx yields a failure carrying the status code and a truncated
 *   body excerpt.
 */
export async function parseModelTestResponse(
	response: Response,
): Promise<ModelTestOutcome> {
	const raw = await response.text().catch(() => "");
	if (!response.ok) {
		return {
			ok: false,
			error: `HTTP ${response.status}: ${truncateExcerpt(raw)}`,
		};
	}
	try {
		const parsed = JSON.parse(raw) as {
			choices?: Array<{ message?: { content?: unknown } }>;
		};
		const content = parsed?.choices?.[0]?.message?.content;
		if (typeof content === "string" && content.trim().length > 0) {
			return { ok: true, content: truncateExcerpt(content) };
		}
	} catch {
		// Not JSON — fall through to the raw excerpt (custom best-effort).
	}
	return { ok: true, content: truncateExcerpt(raw) };
}
