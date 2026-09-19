const TURNSTILE_SCRIPT_SRC =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Minimal surface of the Turnstile client API we use (explicit render). */
export type TurnstileApi = {
	render: (
		element: HTMLElement,
		params: {
			sitekey: string;
			theme?: "light" | "dark" | "auto";
			size?: "normal" | "flexible" | "compact";
			callback?: (token: string) => void;
			"expired-callback"?: () => void;
		},
	) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId: string) => void;
};

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

let loadPromise: Promise<TurnstileApi> | null = null;

/**
 * Loads the Turnstile api.js exactly once (concurrent calls share one promise).
 * Resolves with the global client API; a failed load clears the singleton so a
 * later call can retry. Callers must only invoke this when Turnstile is
 * actually enabled — never load the script for unconfigured deployments.
 */
export function loadTurnstileScript(): Promise<TurnstileApi> {
	if (window.turnstile) {
		return Promise.resolve(window.turnstile);
	}
	if (loadPromise) {
		return loadPromise;
	}
	loadPromise = new Promise<TurnstileApi>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = TURNSTILE_SCRIPT_SRC;
		script.async = true;
		script.onload = () => {
			if (window.turnstile) {
				resolve(window.turnstile);
			} else {
				loadPromise = null;
				reject(new Error("Turnstile script loaded without API"));
			}
		};
		script.onerror = () => {
			loadPromise = null;
			script.remove();
			reject(new Error("Failed to load Turnstile script"));
		};
		document.head.appendChild(script);
	});
	return loadPromise;
}
