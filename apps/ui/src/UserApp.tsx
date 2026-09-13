import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "hono/jsx/dom";
import { createApiFetch } from "./core/api";
import { userTabs } from "./core/constants";
import type {
	MonitoringData,
	PublicModelItem,
	Token,
	UsageLog,
	User,
	UserDashboardData,
	UserTabId,
} from "./core/types";
import { MonitoringView } from "./features/MonitoringView";
import { UserDashboard } from "./features/UserDashboard";
import { UserModelsView } from "./features/UserModelsView";
import { UserTokensView } from "./features/UserTokensView";
import { UserUsageView } from "./features/UserUsageView";

export type ModelAliasConfig = {
	aliases: string[];
	alias_only: boolean;
};

export type ModelAliasesMap = Record<string, ModelAliasConfig>;

type UserAppProps = {
	token: string;
	user: User;
	updateToken: (next: string | null) => void;
	onNavigate: (path: string) => void;
	linuxdoEnabled: boolean;
	onUserRefresh: () => void;
};

const normalizePath = (path: string) => {
	if (path.length <= 1) return "/";
	return path.replace(/\/+$/, "") || "/";
};

const userTabToPath: Record<UserTabId, string> = {
	dashboard: "/user",
	monitoring: "/user/monitoring",
	models: "/user/models",
	tokens: "/user/tokens",
	usage: "/user/usage",
};

const userPathToTab: Record<string, UserTabId> = {
	"/user": "dashboard",
	"/user/monitoring": "monitoring",
	"/user/models": "models",
	"/user/tokens": "tokens",
	"/user/usage": "usage",
};

export const UserApp = ({
	token,
	user,
	updateToken,
	onNavigate,
	linuxdoEnabled,
	onUserRefresh,
}: UserAppProps) => {
	const [activeTab, setActiveTab] = useState<UserTabId>(() => {
		const normalized = normalizePath(window.location.pathname);
		return userPathToTab[normalized] ?? "dashboard";
	});
	const [loading, setLoading] = useState(false);
	const [notice, setNotice] = useState("");
	const [dashboardData, setDashboardData] = useState<UserDashboardData | null>(
		null,
	);
	const [models, setModels] = useState<PublicModelItem[]>([]);
	const [tokens, setTokens] = useState<Token[]>([]);
	const [usage, setUsage] = useState<UsageLog[]>([]);
	const [monitoring, setMonitoring] = useState<MonitoringData | null>(null);
	const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);

	// Handle Linux DO bind callback parameters
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const bindOk = params.get("linuxdo_bindok");
		const bindError = params.get("linuxdo_binderror");
		const rechargeOk = params.get("recharge");
		if (bindOk) {
			history.replaceState(null, "", "/user");
			setNotice("Linux DO 账号绑定成功");
			onUserRefresh();
		} else if (bindError) {
			history.replaceState(null, "", "/user");
			const errorMessages: Record<string, string> = {
				missing_token: "绑定失败：缺少令牌",
				invalid_token: "绑定失败：令牌无效或已过期",
				user_not_found: "绑定失败：用户不存在",
				already_bound: "绑定失败：已绑定 Linux DO 账号",
				linuxdo_already_taken: "绑定失败：该 Linux DO 账号已被其他用户绑定",
				invalid_bind_cookie: "绑定失败：绑定状态无效",
			};
			setNotice(errorMessages[bindError] ?? `绑定失败：${bindError}`);
		} else if (rechargeOk === "ok") {
			history.replaceState(null, "", "/user");
			setNotice("充值成功，余额已更新");
			onUserRefresh();
		}
	}, [onUserRefresh]);

	const apiFetch = useMemo(
		() => createApiFetch(token, () => updateToken(null)),
		[token, updateToken],
	);

	const loadDashboard = useCallback(async () => {
		const data = await apiFetch<UserDashboardData>("/api/u/dashboard");
		setDashboardData(data);
	}, [apiFetch]);

	const loadModels = useCallback(async () => {
		const result = await apiFetch<{ models: PublicModelItem[] }>(
			"/api/u/models",
		);
		setModels(result.models);
	}, [apiFetch]);

	const loadTokens = useCallback(async () => {
		const result = await apiFetch<{ tokens: Token[] }>("/api/u/tokens");
		setTokens(result.tokens);
	}, [apiFetch]);

	const loadUsage = useCallback(async () => {
		const result = await apiFetch<{ logs: UsageLog[] }>(
			"/api/u/usage?limit=200",
		);
		setUsage(result.logs);
	}, [apiFetch]);

	const loadMonitoring = useCallback(async () => {
		const data = await apiFetch<MonitoringData>("/api/monitoring?range=15m");
		setMonitoring(data);
	}, [apiFetch]);

	const handleMonitoringLoaded = useCallback((data: MonitoringData) => {
		setMonitoring(data);
	}, []);

	const loadedTabs = useRef<Set<string>>(new Set<string>());

	const loadTab = useCallback(
		async (tabId: UserTabId) => {
			if (!loadedTabs.current!.has(tabId)) setLoading(true);
			setNotice("");
			try {
				if (tabId === "dashboard") await loadDashboard();
				if (tabId === "monitoring") await loadMonitoring();
				if (tabId === "models") await loadModels();
				if (tabId === "tokens") {
					await loadTokens();
					await loadModels();
				}
				if (tabId === "usage") await loadUsage();
				loadedTabs.current!.add(tabId);
			} catch (error) {
				setNotice((error as Error).message);
			} finally {
				setLoading(false);
			}
		},
		[loadDashboard, loadMonitoring, loadModels, loadTokens, loadUsage],
	);

	useEffect(() => {
		loadTab(activeTab);
	}, [activeTab, loadTab]);

	useEffect(() => {
		const handlePopState = () => {
			const normalized = normalizePath(window.location.pathname);
			setActiveTab(userPathToTab[normalized] ?? "dashboard");
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const handleTabChange = useCallback((tabId: UserTabId) => {
		const nextPath = userTabToPath[tabId];
		const normalized = normalizePath(window.location.pathname);
		if (normalized !== nextPath) {
			history.pushState(null, "", nextPath);
		}
		setActiveTab(tabId);
		setMobileMenuOpen(false);
	}, []);

	const handleLogout = useCallback(async () => {
		await apiFetch("/api/u/auth/logout", { method: "POST" }).catch(() => null);
		updateToken(null);
	}, [apiFetch, updateToken]);

	const handleLinuxdoUnbind = useCallback(async () => {
		try {
			await apiFetch("/api/u/auth/linuxdo/unbind", { method: "POST" });
			setNotice("Linux DO 账号已解除绑定");
			onUserRefresh();
		} catch (error) {
			setNotice((error as Error).message);
		}
	}, [apiFetch, onUserRefresh]);

	const handleTokenCreate = useCallback(
		async (name: string) => {
			try {
				const result = await apiFetch<{ token: string }>("/api/u/tokens", {
					method: "POST",
					body: JSON.stringify({ name }),
				});
				setNotice(`新令牌: ${result.token}`);
				await loadTokens();
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, loadTokens],
	);

	const handleTokenDelete = useCallback(
		async (id: string) => {
			try {
				await apiFetch(`/api/u/tokens/${id}`, { method: "DELETE" });
				await loadTokens();
				setNotice("令牌已删除");
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch, loadTokens],
	);

	const handleTokenReveal = useCallback(
		async (id: string) => {
			try {
				const result = await apiFetch<{ token: string | null }>(
					`/api/u/tokens/${id}/reveal`,
				);
				if (!result.token) {
					setNotice("未找到令牌");
					return;
				}
				try {
					await navigator.clipboard.writeText(result.token);
					setNotice(`令牌已复制到剪贴板：${result.token}`);
				} catch {
					setNotice(`令牌: ${result.token}`);
				}
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[apiFetch],
	);

	const toggleMobileMenu = useCallback(
		() => setMobileMenuOpen((prev) => !prev),
		[],
	);

	const activeLabel = useMemo(
		() => userTabs.find((tab) => tab.id === activeTab)?.label ?? "用户面板",
		[activeTab],
	);

	const renderContent = () => {
		if (loading) {
			return (
				<div class="rounded-2xl border border-stone-200 bg-white p-5 shadow-lg">
					加载中...
				</div>
			);
		}
		if (activeTab === "dashboard") {
			return (
				<UserDashboard
					data={dashboardData}
					user={user}
					token={token}
					updateToken={updateToken}
					linuxdoEnabled={linuxdoEnabled}
					onUnbind={handleLinuxdoUnbind}
					onUserRefresh={onUserRefresh}
				/>
			);
		}
		if (activeTab === "monitoring") {
			return (
				<MonitoringView
					monitoring={monitoring}
					token={token}
					onLoaded={handleMonitoringLoaded}
				/>
			);
		}
		if (activeTab === "models") {
			return <UserModelsView models={models} />;
		}
		if (activeTab === "tokens") {
			return (
				<UserTokensView
					tokens={tokens}
					onCreate={handleTokenCreate}
					onDelete={handleTokenDelete}
					onReveal={handleTokenReveal}
				/>
			);
		}
		if (activeTab === "usage") {
			return <UserUsageView usage={usage} />;
		}
		return null;
	};

	return (
		<div class="grid min-h-screen grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[260px_1fr] lg:grid-rows-none">
			{/* Mobile top bar */}
			<div class="sticky top-0 z-40 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-3 lg:hidden">
				<button
					class="flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 transition-all hover:bg-stone-50 hover:text-stone-900"
					type="button"
					onClick={toggleMobileMenu}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="2"
						stroke="currentColor"
						class="h-5 w-5"
					>
						{isMobileMenuOpen ? (
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M6 18L18 6M6 6l12 12"
							/>
						) : (
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
							/>
						)}
					</svg>
				</button>
				<button
					type="button"
					class="font-['Space_Grotesk'] text-sm font-semibold tracking-tight text-stone-900"
					onClick={() => onNavigate("/")}
				>
					ZenAPI
				</button>
				<div class="w-10" />
			</div>

			{/* Mobile overlay */}
			{isMobileMenuOpen && (
				<div class="fixed inset-0 z-50 lg:hidden">
					<button
						type="button"
						class="absolute inset-0 bg-stone-900/40"
						tabIndex={-1}
						onClick={toggleMobileMenu}
						onKeyDown={(e) => {
							if ((e as KeyboardEvent).key === "Escape") toggleMobileMenu();
						}}
					/>
					<aside class="absolute left-0 top-0 h-full w-[280px] border-r border-stone-200 bg-white px-5 py-8 shadow-xl">
						<div class="mb-8 flex flex-col gap-1.5">
							<button
								type="button"
								class="font-['Space_Grotesk'] text-lg font-semibold tracking-tight text-stone-900 text-left"
								onClick={() => onNavigate("/")}
							>
								ZenAPI
							</button>
							<span class="text-xs text-stone-500">
								{user.name} ({user.email})
							</span>
						</div>
						<nav class="flex flex-col gap-2.5">
							{userTabs.map((tab) => (
								<button
									class={`flex h-11 w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-all ${
										activeTab === tab.id
											? "bg-stone-100 text-stone-900"
											: "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
									}`}
									type="button"
									onClick={() => {
										handleTabChange(tab.id);
										toggleMobileMenu();
									}}
								>
									{tab.label}
								</button>
							))}
						</nav>
						<div class="mt-8 border-t border-stone-200 pt-4">
							<button
								class="h-11 w-full rounded-lg border border-stone-200 bg-transparent px-4 py-2.5 text-sm font-semibold text-stone-500 transition-all hover:text-stone-900"
								type="button"
								onClick={handleLogout}
							>
								退出
							</button>
						</div>
					</aside>
				</div>
			)}

			{/* Desktop sidebar */}
			<aside class="hidden border-b border-stone-200 bg-white px-5 py-8 lg:sticky lg:top-0 lg:block lg:h-screen lg:border-b-0 lg:border-r">
				<div class="mb-8 flex flex-col gap-1.5">
					<button
						type="button"
						class="font-['Space_Grotesk'] text-lg font-semibold tracking-tight text-stone-900 text-left"
						onClick={() => onNavigate("/")}
					>
						ZenAPI
					</button>
					<span class="text-xs text-stone-500">
						{user.name} ({user.email})
					</span>
				</div>
				<nav class="flex flex-col gap-2.5">
					{userTabs.map((tab) => (
						<button
							class={`flex h-11 w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-all ${
								activeTab === tab.id
									? "bg-stone-100 text-stone-900"
									: "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
							}`}
							type="button"
							onClick={() => handleTabChange(tab.id)}
						>
							{tab.label}
						</button>
					))}
				</nav>
				<div class="mt-8 border-t border-stone-200 pt-4">
					<button
						type="button"
						class="mb-3 block w-full text-center text-xs text-stone-400 hover:text-stone-600"
						onClick={() => onNavigate("/admin")}
					>
						管理后台
					</button>
					<button
						class="h-11 w-full rounded-lg border border-stone-200 bg-transparent px-4 py-2.5 text-sm font-semibold text-stone-500 transition-all hover:text-stone-900"
						type="button"
						onClick={handleLogout}
					>
						退出
					</button>
				</div>
			</aside>

			<main class="px-4 pt-4 pb-16 sm:px-6 sm:pt-6 md:px-10 md:pt-8">
				<div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h1 class="font-['Space_Grotesk'] text-xl md:text-2xl tracking-tight text-stone-900">
							{activeLabel}
						</h1>
						<p class="text-sm text-stone-500">
							余额: ${user.balance.toFixed(2)}
						</p>
					</div>
					<div class="hidden sm:flex items-center gap-3">
						<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-500">
							{user.email}
						</span>
						<button
							class="h-11 rounded-lg border border-stone-200 bg-transparent px-4 py-2.5 text-sm font-semibold text-stone-500 transition-all hover:text-stone-900"
							type="button"
							onClick={handleLogout}
						>
							退出
						</button>
					</div>
				</div>
				{notice && (
					<div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
						{notice}
					</div>
				)}
				<div key={activeTab}>{renderContent()}</div>
			</main>
		</div>
	);
};
