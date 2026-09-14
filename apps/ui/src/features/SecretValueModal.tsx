import { toast } from "../core/toast";

type SecretValueModalProps = {
	title: string;
	value: string;
	onClose: () => void;
};

export const SecretValueModal = ({
	title,
	value,
	onClose,
}: SecretValueModalProps) => {
	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			toast.success("已复制到剪贴板");
		} catch {
			toast.error("复制失败，请手动选择复制");
		}
	};

	return (
		<div class="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-stone-900/40 px-0 md:px-4 py-0 md:py-8">
			<div class="w-full max-w-xl rounded-t-2xl md:rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<h3 class="mb-1 font-['Space_Grotesk'] text-lg tracking-tight text-stone-900">
						{title}
					</h3>
					<button
						class="h-10 md:h-9 rounded-full border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-500 transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:text-stone-900 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
						type="button"
						onClick={onClose}
					>
						关闭
					</button>
				</div>
				<pre class="mt-4 break-all rounded-lg bg-stone-50 p-3 font-mono text-xs whitespace-pre-wrap">
					{value}
				</pre>
				<div class="mt-4 flex flex-wrap items-center justify-end gap-2">
					<button
						class="h-10 rounded-full bg-stone-900 px-5 text-xs font-semibold text-white transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
						type="button"
						onClick={handleCopy}
					>
						复制
					</button>
				</div>
			</div>
		</div>
	);
};
