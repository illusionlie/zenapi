/**
 * 骨架屏加载态:按内容布局归类的灰块占位 + shimmer 微光(styles.css §骨架屏)。
 * 外壳复用被替换「加载中...」卡片的容器类,保证高度占位近似,减少加载完成后的布局跳动。
 */

/** 骨架积木:小场景(详情面板等)内联组装用。装饰块对读屏器静音 */
export const SkeletonBlock = ({ class: cls }: { class?: string }) => (
	<div class={`skeleton ${cls ?? ""}`} aria-hidden="true" />
);

export type SkeletonVariant = "stats" | "table" | "form" | "generic";

/** 整页加载骨架:role=status 向读屏器播报加载态,内部装饰块全部 aria-hidden */
export const ViewSkeleton = ({ variant }: { variant: SkeletonVariant }) => (
	<div
		role="status"
		aria-label="加载中"
		class="t-view-enter rounded-2xl border border-stone-200 bg-white p-5 shadow-lg"
	>
		<SkeletonBlock class="mb-5 h-7 w-40" />
		{variant === "stats" && (
			<div class="space-y-5">
				<div class="grid grid-cols-1 gap-5 sm:grid-cols-3">
					<SkeletonBlock class="h-24" />
					<SkeletonBlock class="h-24" />
					<SkeletonBlock class="h-24" />
				</div>
				<SkeletonBlock class="h-10 w-full" />
				<SkeletonBlock class="h-10 w-5/6" />
			</div>
		)}
		{variant === "table" && (
			<div class="space-y-2.5">
				<SkeletonBlock class="h-8 w-full" />
				<SkeletonBlock class="h-10 w-full" />
				<SkeletonBlock class="h-10 w-11/12" />
				<SkeletonBlock class="h-10 w-full" />
				<SkeletonBlock class="h-10 w-full" />
				<SkeletonBlock class="h-10 w-5/6" />
				<SkeletonBlock class="h-10 w-2/5" />
			</div>
		)}
		{variant === "form" && (
			<div class="space-y-5">
				<div class="space-y-2">
					<SkeletonBlock class="h-4 w-24" />
					<SkeletonBlock class="h-10 w-full" />
				</div>
				<div class="space-y-2">
					<SkeletonBlock class="h-4 w-16" />
					<SkeletonBlock class="h-10 w-full" />
				</div>
				<div class="space-y-2">
					<SkeletonBlock class="h-4 w-20" />
					<SkeletonBlock class="h-10 w-full" />
				</div>
				<div class="space-y-2">
					<SkeletonBlock class="h-4 w-24" />
					<SkeletonBlock class="h-10 w-5/6" />
				</div>
				<SkeletonBlock class="h-10 w-32" />
			</div>
		)}
		{variant === "generic" && (
			<div class="space-y-5">
				<SkeletonBlock class="h-24 w-full" />
				<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<SkeletonBlock class="h-32" />
					<SkeletonBlock class="h-32" />
				</div>
				<SkeletonBlock class="h-10 w-2/3" />
			</div>
		)}
	</div>
);
