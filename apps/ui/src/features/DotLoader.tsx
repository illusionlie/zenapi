/** 三点 bounce 加载指示器,对齐 PlaygroundView 既有节奏(0.1s 逐点延迟) */
export const DotLoader = ({ class: cls }: { class?: string }) => (
	<span
		class={`inline-flex gap-1 ${cls ?? ""}`}
		role="status"
		aria-label="加载中"
	>
		<span class="animate-bounce">·</span>
		<span class="animate-bounce" style="animation-delay: 0.1s">
			·
		</span>
		<span class="animate-bounce" style="animation-delay: 0.2s">
			·
		</span>
	</span>
);
