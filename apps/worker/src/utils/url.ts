/**
 * Normalizes upstream base URLs and strips a trailing /v1 segment.
 *
 * Args:
 *   baseUrl: Raw upstream base URL.
 *
 * Returns:
 *   Normalized base URL without trailing slashes or /v1.
 */
export function normalizeBaseUrl(baseUrl: string): string {
	if (!baseUrl) {
		return "";
	}
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	return trimmed.replace(/\/v1$/i, "");
}

/**
 * Rewrites bare-IP URLs to use sslip.io so Cloudflare Workers can fetch them.
 * e.g. http://1.2.3.4:8080/v1 → http://1.2.3.4.sslip.io:8080/v1
 */
/**
 * Extracts the hostname from a URL string, lowercased.
 */
export function extractHostname(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return "";
	}
}

/**
 * Checks if a channel hostname matches a site hostname (exact or subdomain).
 * e.g. "api.example.com" matches "example.com", "example.com" matches "example.com"
 */
export function hostnameMatches(
	channelHostname: string,
	siteHostname: string,
): boolean {
	if (!channelHostname || !siteHostname) return false;
	return (
		channelHostname === siteHostname ||
		channelHostname.endsWith(`.${siteHostname}`)
	);
}

/**
 * Rewrites bare-IP URLs to use sslip.io so Cloudflare Workers can fetch them.
 * e.g. http://1.2.3.4:8080/v1 → http://1.2.3.4.sslip.io:8080/v1
 */
export function cfSafeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) {
			parsed.hostname = `${parsed.hostname}.sslip.io`;
			return parsed.toString().replace(/\/$/, "");
		}
		return url;
	} catch {
		return url;
	}
}
