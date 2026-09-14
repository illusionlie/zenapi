import { describe, expect, it } from "vitest";
import type { ChannelRecord } from "../apps/worker/src/services/channels";
import { buildChannelRequest } from "../apps/worker/src/routes/proxy";
import {
	applyHeaderPolicy,
	parseExtraHeaders,
	parseRemoveHeaders,
	type ProxyHeaderPolicy,
} from "../apps/worker/src/utils/proxy-headers";

describe("parseExtraHeaders", () => {
	it("parses a valid JSON object with string values", () => {
		expect(parseExtraHeaders('{"X-Trace-Id":"zen"}')).toEqual({
			"X-Trace-Id": "zen",
		});
		expect(parseExtraHeaders('{"a":"1","b":"2"}')).toEqual({ a: "1", b: "2" });
	});

	it("returns an empty object for an empty JSON object", () => {
		expect(parseExtraHeaders("{}")).toEqual({});
	});

	it("returns null when any value is not a string", () => {
		expect(parseExtraHeaders('{"a":1}')).toBeNull();
		expect(parseExtraHeaders('{"a":null}')).toBeNull();
		expect(parseExtraHeaders('{"a":true}')).toBeNull();
		expect(parseExtraHeaders('{"a":{"b":"c"}}')).toBeNull();
		expect(parseExtraHeaders('{"a":["x"]}')).toBeNull();
	});

	it("returns null for non-object JSON (scalars and arrays)", () => {
		expect(parseExtraHeaders('"str"')).toBeNull();
		expect(parseExtraHeaders("42")).toBeNull();
		expect(parseExtraHeaders("true")).toBeNull();
		expect(parseExtraHeaders('["a"]')).toBeNull();
		expect(parseExtraHeaders("null")).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		expect(parseExtraHeaders("{")).toBeNull();
		expect(parseExtraHeaders("not-json")).toBeNull();
		expect(parseExtraHeaders('{"a":}')).toBeNull();
	});

	it("treats empty/missing input as an empty config (fail-open read)", () => {
		expect(parseExtraHeaders("")).toEqual({});
		expect(parseExtraHeaders(null)).toEqual({});
		expect(parseExtraHeaders(undefined)).toEqual({});
	});
});

describe("parseRemoveHeaders", () => {
	it("parses a valid JSON array of strings", () => {
		expect(parseRemoveHeaders('["user-agent","x-foo"]')).toEqual([
			"user-agent",
			"x-foo",
		]);
	});

	it("returns an empty array for an empty JSON array", () => {
		expect(parseRemoveHeaders("[]")).toEqual([]);
	});

	it("returns null when any element is not a string", () => {
		expect(parseRemoveHeaders('["a",1]')).toBeNull();
		expect(parseRemoveHeaders('["a",null]')).toBeNull();
		expect(parseRemoveHeaders('["a",{"b":1}]')).toBeNull();
	});

	it("returns null for non-array JSON (objects and scalars)", () => {
		expect(parseRemoveHeaders('{"a":"b"}')).toBeNull();
		expect(parseRemoveHeaders('"str"')).toBeNull();
		expect(parseRemoveHeaders("42")).toBeNull();
		expect(parseRemoveHeaders("true")).toBeNull();
		expect(parseRemoveHeaders("null")).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		expect(parseRemoveHeaders("[")).toBeNull();
		expect(parseRemoveHeaders("not-json")).toBeNull();
	});

	it("treats empty/missing input as an empty config (fail-open read)", () => {
		expect(parseRemoveHeaders("")).toEqual([]);
		expect(parseRemoveHeaders(null)).toEqual([]);
		expect(parseRemoveHeaders(undefined)).toEqual([]);
	});
});

describe("applyHeaderPolicy", () => {
	it("removes listed client headers first", () => {
		const headers = new Headers({
			"user-agent": "client",
			"x-keep": "1",
		});
		applyHeaderPolicy(
			headers,
			{ extraHeaders: {}, removeHeaders: ["user-agent"] },
			null,
		);
		expect(headers.get("user-agent")).toBeNull();
		expect(headers.get("x-keep")).toBe("1");
	});

	it("removes headers case-insensitively (Headers API)", () => {
		const headers = new Headers({ "User-Agent": "client" });
		applyHeaderPolicy(
			headers,
			{ extraHeaders: {}, removeHeaders: ["USER-AGENT"] },
			null,
		);
		expect(headers.get("user-agent")).toBeNull();
	});

	it("injects global headers and overrides built-in ones", () => {
		const headers = new Headers({ authorization: "Bearer built-in" });
		applyHeaderPolicy(
			headers,
			{
				extraHeaders: { Authorization: "Bearer global", "X-Trace-Id": "zen" },
				removeHeaders: [],
			},
			null,
		);
		expect(headers.get("authorization")).toBe("Bearer global");
		expect(headers.get("x-trace-id")).toBe("zen");
	});

	it("channel-level headers override global injection (last wins)", () => {
		const headers = new Headers();
		applyHeaderPolicy(
			headers,
			{ extraHeaders: { "X-Trace-Id": "global" }, removeHeaders: [] },
			'{"X-Trace-Id":"channel"}',
		);
		expect(headers.get("x-trace-id")).toBe("channel");
	});

	it("applies remove → inject → channel in fixed order", () => {
		const headers = new Headers({
			"x-remove-me": "1",
			"x-both": "client",
		});
		applyHeaderPolicy(
			headers,
			{
				extraHeaders: { "x-both": "global", "x-inject": "g" },
				removeHeaders: ["x-remove-me"],
			},
			'{"x-both":"channel"}',
		);
		expect(headers.get("x-remove-me")).toBeNull();
		expect(headers.get("x-inject")).toBe("g");
		expect(headers.get("x-both")).toBe("channel");
	});

	it("with null policy, only channel-level headers apply (Playground exemption)", () => {
		const headers = new Headers({
			"user-agent": "client",
			"x-keep": "1",
		});
		applyHeaderPolicy(headers, null, '{"X-Channel":"1"}');
		expect(headers.get("user-agent")).toBe("client");
		expect(headers.get("x-keep")).toBe("1");
		expect(headers.get("x-channel")).toBe("1");
	});

	it("ignores invalid channel-level JSON without touching headers", () => {
		const headers = new Headers({ authorization: "Bearer x" });
		applyHeaderPolicy(headers, null, "not-json");
		expect(headers.get("authorization")).toBe("Bearer x");
		applyHeaderPolicy(headers, null, null);
		applyHeaderPolicy(headers, null, undefined);
		applyHeaderPolicy(headers, null, "");
		expect(headers.get("authorization")).toBe("Bearer x");
	});
});

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

describe("buildChannelRequest header policy matrix", () => {
	const policy: ProxyHeaderPolicy = {
		extraHeaders: { "X-Trace-Id": "global", Authorization: "Bearer global" },
		removeHeaders: ["user-agent"],
	};

	it("openai: injects global headers and removes client headers", () => {
		const channel = makeChannel({ api_format: "openai" });
		const incoming = new Headers({
			"user-agent": "client",
			"x-client": "1",
		});
		const { headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			incoming,
			"{}",
			null,
			false,
			"sk-call",
			policy,
		);
		expect(headers.get("x-trace-id")).toBe("global");
		expect(headers.get("authorization")).toBe("Bearer global");
		expect(headers.get("user-agent")).toBeNull();
		expect(headers.get("x-client")).toBe("1");
	});

	it("openai: keeps built-in Authorization when policy does not inject it", () => {
		const channel = makeChannel({ api_format: "openai" });
		const { headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			"{}",
			null,
			false,
			"sk-call",
			{ extraHeaders: { "X-Trace-Id": "global" }, removeHeaders: [] },
		);
		expect(headers.get("authorization")).toBe("Bearer sk-call");
		expect(headers.get("x-trace-id")).toBe("global");
	});

	it("anthropic: injects global headers, overrides built-ins, removes client headers", () => {
		const channel = makeChannel({ api_format: "anthropic" });
		const incoming = new Headers({
			"user-agent": "client",
			authorization: "Bearer client",
		});
		const { headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			incoming,
			"{}",
			{},
			false,
			"sk-call",
			policy,
		);
		expect(headers.get("x-api-key")).toBe("sk-call");
		expect(headers.get("anthropic-version")).toBe("2023-06-01");
		expect(headers.get("x-trace-id")).toBe("global");
		expect(headers.get("authorization")).toBe("Bearer global");
		expect(headers.get("user-agent")).toBeNull();
	});

	it("anthropic: channel-level custom headers now apply (previously ignored)", () => {
		const channel = makeChannel({
			api_format: "anthropic",
			custom_headers_json: '{"X-Channel":"1"}',
		});
		const { headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			new Headers(),
			"{}",
			{},
			false,
			"sk-call",
			policy,
		);
		expect(headers.get("x-channel")).toBe("1");
	});

	it("custom: channel-level overrides global injection (unified merge, no double apply)", () => {
		const channel = makeChannel({
			api_format: "custom",
			custom_headers_json: '{"X-Trace-Id":"channel","X-Channel":"1"}',
		});
		const incoming = new Headers({ "user-agent": "client" });
		const { headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			incoming,
			"{}",
			null,
			false,
			"sk-call",
			policy,
		);
		expect(headers.get("x-trace-id")).toBe("channel");
		expect(headers.get("x-channel")).toBe("1");
		expect(headers.get("authorization")).toBe("Bearer global");
		expect(headers.get("user-agent")).toBeNull();
	});

	it("without policy: only channel-level headers apply (zero-regression baseline)", () => {
		const channel = makeChannel({
			api_format: "openai",
			custom_headers_json: '{"X-Channel":"1"}',
		});
		const incoming = new Headers({ "user-agent": "client" });
		const { headers } = buildChannelRequest(
			channel,
			"/v1/chat/completions",
			"",
			incoming,
			"{}",
			null,
			false,
			"sk-call",
		);
		expect(headers.get("x-channel")).toBe("1");
		expect(headers.get("user-agent")).toBe("client");
		expect(headers.get("authorization")).toBe("Bearer sk-call");
		expect(headers.get("x-trace-id")).toBeNull();
	});
});
