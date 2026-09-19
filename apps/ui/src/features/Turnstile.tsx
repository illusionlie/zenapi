import { useEffect, useRef } from "hono/jsx/dom";
import { loadTurnstileScript } from "../core/turnstile";

type TurnstileProps = {
	siteKey: string;
	onToken: (token: string) => void;
	/** 计数 prop：容器递增即重置 widget 并清空 token（token 一次性） */
	resetSignal: number;
};

/**
 * Cloudflare Turnstile widget shell (explicit render).
 *
 * Loads api.js via the core singleton, renders into a ref container, and
 * resets whenever the container bumps `resetSignal` — every submit failure
 * must produce a fresh token because tokens are single-use.
 */
export const Turnstile = ({
	siteKey,
	onToken,
	resetSignal,
}: TurnstileProps) => {
	const containerRef = useRef<HTMLFieldSetElement>(null);
	const widgetIdRef = useRef<string | null>(null);
	const onTokenRef = useRef(onToken);
	const lastResetSignalRef = useRef(resetSignal);

	useEffect(() => {
		onTokenRef.current = onToken;
	}, [onToken]);

	useEffect(() => {
		let cancelled = false;
		loadTurnstileScript()
			.then((turnstile) => {
				if (cancelled || !containerRef.current) {
					return;
				}
				widgetIdRef.current = turnstile.render(containerRef.current, {
					sitekey: siteKey,
					theme: "light",
					size: "flexible",
					callback: (token: string) => onTokenRef.current(token),
					"expired-callback": () => onTokenRef.current(""),
				});
			})
			.catch(() => {
				// Script load failed — submission will surface the server error.
			});
		return () => {
			cancelled = true;
			if (widgetIdRef.current !== null) {
				window.turnstile?.remove(widgetIdRef.current);
				widgetIdRef.current = null;
			}
		};
	}, [siteKey]);

	useEffect(() => {
		if (resetSignal === lastResetSignalRef.current) {
			return;
		}
		lastResetSignalRef.current = resetSignal;
		const widgetId = widgetIdRef.current;
		if (window.turnstile && widgetId !== null) {
			window.turnstile.reset(widgetId);
		}
		onTokenRef.current("");
	}, [resetSignal]);

	return (
		<fieldset
			aria-label="Cloudflare 人机验证"
			class="min-w-0"
			ref={containerRef}
		/>
	);
};
