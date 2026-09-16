import { describe, expect, it } from "vitest";
import type { TokenRecord } from "../apps/worker/src/middleware/tokenAuth";
import { filterAllowedChannels } from "../apps/worker/src/routes/proxy";
import type { ChannelRecord } from "../apps/worker/src/services/channels";

function makeChannel(id: string): ChannelRecord {
	return {
		id,
		name: `channel-${id}`,
		base_url: "https://example.com",
		api_key: "sk-test",
		weight: 1,
		status: "active",
		api_format: "openai",
	};
}

function makeToken(allowedChannels: string | null): TokenRecord {
	return {
		id: "t1",
		name: "token",
		quota_total: null,
		quota_used: 0,
		status: "active",
		allowed_channels: allowedChannels,
		allowed_models: null,
		user_id: null,
	};
}

const channels = [makeChannel("ch1"), makeChannel("ch2"), makeChannel("ch3")];
const ids = (result: ChannelRecord[]) => result.map((ch) => ch.id);

describe("filterAllowedChannels", () => {
	it("returns all channels when allowed_channels is null (unrestricted)", () => {
		expect(ids(filterAllowedChannels(channels, makeToken(null)))).toEqual([
			"ch1",
			"ch2",
			"ch3",
		]);
	});

	it("returns all channels for malformed JSON (fail open)", () => {
		expect(
			ids(filterAllowedChannels(channels, makeToken("{broken"))),
		).toEqual(["ch1", "ch2", "ch3"]);
		expect(
			ids(filterAllowedChannels(channels, makeToken("null"))),
		).toEqual(["ch1", "ch2", "ch3"]);
	});

	it("filters by the legacy flat array format", () => {
		expect(
			ids(filterAllowedChannels(channels, makeToken('["ch1","ch3"]'))),
		).toEqual(["ch1", "ch3"]);
	});

	it("returns all channels for an empty legacy array", () => {
		expect(
			ids(filterAllowedChannels(channels, makeToken("[]"))),
		).toEqual(["ch1", "ch2", "ch3"]);
	});

	it("filters by the per-model map format for the requested model", () => {
		const token = makeToken('{"m1":["ch2"]}');
		expect(ids(filterAllowedChannels(channels, token, "m1"))).toEqual([
			"ch2",
		]);
	});

	it("returns all channels when the model has no entry in the map", () => {
		const token = makeToken('{"m1":["ch2"]}');
		expect(ids(filterAllowedChannels(channels, token, "m2"))).toEqual([
			"ch1",
			"ch2",
			"ch3",
		]);
	});

	it("returns all channels for the per-model map when no model is given", () => {
		const token = makeToken('{"m1":["ch2"]}');
		expect(ids(filterAllowedChannels(channels, token))).toEqual([
			"ch1",
			"ch2",
			"ch3",
		]);
	});

	it("returns all channels when the map entry is an empty array", () => {
		const token = makeToken('{"m1":[]}');
		expect(ids(filterAllowedChannels(channels, token, "m1"))).toEqual([
			"ch1",
			"ch2",
			"ch3",
		]);
	});
});
