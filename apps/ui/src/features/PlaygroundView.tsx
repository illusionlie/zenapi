import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "hono/jsx/dom";
import { apiBase } from "../core/constants";

type ChatMessage = {
	role: "user" | "assistant";
	content: string;
};

type PlaygroundViewProps = {
	token: string;
};

export const PlaygroundView = ({ token }: PlaygroundViewProps) => {
	const [models, setModels] = useState<string[]>([]);
	const [selectedModel, setSelectedModel] = useState("");
	const [modelSearch, setModelSearch] = useState("");
	const [isModelDropdownOpen, setModelDropdownOpen] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	const [error, setError] = useState("");
	const [usage, setUsage] = useState<{
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	} | null>(null);
	const [latencyMs, setLatencyMs] = useState<number | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const modelDropdownRef = useRef<HTMLDivElement>(null);

	const filteredModels = useMemo(() => {
		if (!modelSearch) return models;
		const lower = modelSearch.toLowerCase();
		return models.filter((m) => m.toLowerCase().includes(lower));
	}, [models, modelSearch]);

	// Close dropdown on outside click
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				modelDropdownRef.current &&
				!modelDropdownRef.current.contains(e.target as Node)
			) {
				setModelDropdownOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Load available models
	useEffect(() => {
		const loadModels = async () => {
			try {
				const res = await fetch(`${apiBase}/api/playground/models`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { models: string[] };
				setModels(data.models);
				if (data.models.length > 0 && !selectedModel) {
					setSelectedModel(data.models[0]);
				}
			} catch (err) {
				setError((err as Error).message);
			}
		};
		loadModels();
	}, [token]);

	// Auto-scroll to bottom
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamingContent]);

	const handleClear = useCallback(() => {
		setMessages([]);
		setStreamingContent("");
		setError("");
		setUsage(null);
		setLatencyMs(null);
	}, []);

	const handleSend = useCallback(async () => {
		const trimmed = input.trim();
		if (!trimmed || !selectedModel || isLoading) return;

		setError("");
		setUsage(null);
		setLatencyMs(null);

		const userMessage: ChatMessage = { role: "user", content: trimmed };
		const updatedMessages = [...messages, userMessage];
		setMessages(updatedMessages);
		setInput("");
		setIsLoading(true);
		setStreamingContent("");

		const start = Date.now();

		try {
			const res = await fetch(`${apiBase}/api/playground/chat`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					model: selectedModel,
					messages: updatedMessages.map((m) => ({
						role: m.role,
						content: m.content,
					})),
					stream: true,
				}),
			});

			if (!res.ok) {
				const errBody = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(errBody?.error ?? `HTTP ${res.status}`);
			}

			if (!res.body) {
				throw new Error("No response body");
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let accumulated = "";
			let lastUsage: typeof usage = null;
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				// Keep the last incomplete line in the buffer
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					const trimmedLine = line.trim();
					if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;
					const data = trimmedLine.slice(6);
					if (data === "[DONE]") continue;

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{
								delta?: { content?: string };
							}>;
							usage?: {
								prompt_tokens: number;
								completion_tokens: number;
								total_tokens: number;
							};
						};
						const content = parsed.choices?.[0]?.delta?.content;
						if (content) {
							accumulated += content;
							setStreamingContent(accumulated);
						}
						if (parsed.usage) {
							lastUsage = parsed.usage;
						}
					} catch {
						// Skip unparseable lines
					}
				}
			}

			const elapsed = Date.now() - start;
			setLatencyMs(elapsed);

			if (lastUsage) {
				setUsage(lastUsage);
			}

			// Add assistant message to history
			if (accumulated) {
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: accumulated },
				]);
			}
			setStreamingContent("");
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setIsLoading(false);
		}
	}, [input, selectedModel, isLoading, messages, token]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	return (
		<div class="flex h-full flex-col">
			{/* Header */}
			<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-lg shrink-0">
				<h2 class="text-base font-semibold text-stone-800">对话测试</h2>
				<div class="flex items-center gap-3">
					{/* Searchable model selector */}
					<div class="relative" ref={modelDropdownRef}>
						<input
							class="h-9 w-56 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-stone-700 placeholder:text-stone-400 outline-none transition-colors focus:border-stone-400"
							type="text"
							placeholder="搜索模型..."
							value={
								isModelDropdownOpen ? modelSearch : selectedModel || modelSearch
							}
							onFocus={() => {
								setModelDropdownOpen(true);
								setModelSearch("");
							}}
							onInput={(e) => {
								setModelSearch((e.target as HTMLInputElement).value);
								setModelDropdownOpen(true);
							}}
						/>
						{isModelDropdownOpen && (
							<div class="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
								{filteredModels.length === 0 ? (
									<div class="px-3 py-2 text-xs text-stone-400">
										{models.length === 0 ? "无可用模型" : "未找到匹配模型"}
									</div>
								) : (
									filteredModels.map((m) => (
										<button
											key={m}
											type="button"
											class={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-stone-100 ${
												m === selectedModel
													? "bg-stone-50 font-medium text-stone-900"
													: "text-stone-700"
											}`}
											onClick={() => {
												setSelectedModel(m);
												setModelSearch("");
												setModelDropdownOpen(false);
											}}
										>
											{m}
										</button>
									))
								)}
							</div>
						)}
					</div>
					<button
						type="button"
						class="h-9 rounded-full border border-stone-200 px-4 text-xs font-medium text-stone-600 transition-all duration-200 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2"
						onClick={handleClear}
					>
						清空对话
					</button>
				</div>
			</div>

			{/* Messages Area - flex-1 to fill remaining space */}
			<div class="mt-4 flex flex-1 flex-col rounded-2xl border border-stone-200 bg-white shadow-lg overflow-hidden">
				<div class="flex-1 overflow-y-auto p-5">
					{messages.length === 0 && !streamingContent && (
						<div class="flex h-full min-h-[200px] items-center justify-center">
							<p class="text-sm text-stone-400">选择模型并发送消息开始对话</p>
						</div>
					)}

					<div class="flex flex-col gap-4">
						{messages.map((msg, i) => (
							<div
								key={i}
								class={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
							>
								<div
									class={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
										msg.role === "user"
											? "bg-stone-800 text-white"
											: "border border-stone-200 bg-stone-50 text-stone-800"
									}`}
								>
									{msg.content}
								</div>
							</div>
						))}

						{/* Streaming content */}
						{streamingContent && (
							<div class="flex justify-start">
								<div class="max-w-[80%] rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-stone-800">
									{streamingContent}
									<span class="ml-1 inline-block h-4 w-1.5 animate-pulse bg-stone-400" />
								</div>
							</div>
						)}

						{/* Loading indicator (before streaming starts) */}
						{isLoading && !streamingContent && (
							<div class="flex justify-start">
								<div class="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-400">
									<span class="inline-flex gap-1">
										<span class="animate-bounce">·</span>
										<span class="animate-bounce" style="animation-delay: 0.1s">
											·
										</span>
										<span class="animate-bounce" style="animation-delay: 0.2s">
											·
										</span>
									</span>
								</div>
							</div>
						)}
					</div>
					<div ref={messagesEndRef} />
				</div>

				{/* Error */}
				{error && (
					<div class="border-t border-stone-200 px-5 py-3 shrink-0">
						<p class="text-xs text-red-500">{error}</p>
					</div>
				)}

				{/* Usage Stats */}
				{(usage || latencyMs !== null) && (
					<div class="border-t border-stone-200 px-5 py-2.5 shrink-0">
						<p class="text-xs text-stone-400">
							{usage &&
								`Tokens: ${usage.total_tokens} (prompt ${usage.prompt_tokens} + completion ${usage.completion_tokens})`}
							{usage && latencyMs !== null && " · "}
							{latencyMs !== null && `${latencyMs}ms`}
						</p>
					</div>
				)}

				{/* Input Area */}
				<div class="border-t border-stone-200 p-4 shrink-0">
					<div class="flex gap-3">
						<textarea
							class="flex-1 resize-none rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-800 placeholder-stone-400 outline-none transition-colors focus:border-stone-400"
							rows={2}
							placeholder="输入消息... (Ctrl+Enter 发送)"
							value={input}
							onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
							onKeyDown={handleKeyDown}
							disabled={isLoading}
						/>
						<button
							type="button"
							class="h-10 self-end rounded-full bg-stone-900 px-5 text-xs font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
							onClick={handleSend}
							disabled={isLoading || !selectedModel || !input.trim()}
						>
							{isLoading ? "生成中..." : "发送"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
};
