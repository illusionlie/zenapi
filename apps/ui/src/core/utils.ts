import type { ChannelApiFormat } from "./types";

/**
 * Formats a datetime string for display.
 *
 * Args:
 *   value: ISO datetime string or nullable value.
 *
 * Returns:
 *   A human-friendly datetime string or "-".
 */
const pad2 = (value: number) => String(value).padStart(2, "0");

export const formatDateTime = (value?: string | null) => {
	if (!value) {
		return "-";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "-";
	}
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate(),
	)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
		date.getSeconds(),
	)}`;
};

/**
 * Toggles channel or token status between active and disabled.
 *
 * Args:
 *   value: Current status value.
 *
 * Returns:
 *   Next status value.
 */
export const toggleStatus = (value: string) =>
	value === "active" ? "disabled" : "active";

const API_FORMAT_WHITELIST: readonly string[] = [
	"openai",
	"anthropic",
	"custom",
	"responses",
];

/**
 * Parses a channel's declared API formats from the wire form.
 * Fallback chain mirrors the worker's parseApiFormats read side:
 * api_formats JSON array string (raw TEXT column) -> legacy mirror
 * api_format single value -> default ["openai"].
 *
 * Args:
 *   channel: Channel-like row carrying api_formats / api_format.
 *
 * Returns:
 *   Deduplicated whitelist-filtered format array (never empty).
 */
export const parseChannelApiFormats = (channel: {
	api_formats?: string | null;
	api_format?: string | null;
}): ChannelApiFormat[] => {
	if (
		typeof channel.api_formats === "string" &&
		channel.api_formats.trim() !== ""
	) {
		try {
			const parsed: unknown = JSON.parse(channel.api_formats);
			if (Array.isArray(parsed)) {
				const formats = parsed.filter(
					(value): value is ChannelApiFormat =>
						typeof value === "string" && API_FORMAT_WHITELIST.includes(value),
				);
				const deduped = [...new Set(formats)];
				if (deduped.length > 0) {
					return deduped;
				}
			}
		} catch {
			/* 畸形 JSON 落到下一级兜底 */
		}
	}
	if (
		typeof channel.api_format === "string" &&
		API_FORMAT_WHITELIST.includes(channel.api_format)
	) {
		return [channel.api_format as ChannelApiFormat];
	}
	return ["openai"];
};

export type PageItem = number | "ellipsis";

export const buildPageItems = (current: number, total: number): PageItem[] => {
	if (total <= 6) {
		return Array.from({ length: total }, (_, index) => index + 1);
	}
	const items: PageItem[] = [1, 2, 3];
	if (current > 3 && current < total - 1) {
		items.push("ellipsis", current);
	}
	items.push("ellipsis", total - 1, total);
	return items.filter((item, index, array) => {
		if (item === "ellipsis" && array[index - 1] === "ellipsis") {
			return false;
		}
		if (typeof item === "number") {
			return array.indexOf(item) === index;
		}
		return true;
	});
};
