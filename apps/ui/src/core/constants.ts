import type {
	AdminData,
	ChannelForm,
	SettingsForm,
	TabItem,
	UserTabItem,
} from "./types";

export const apiBase = import.meta.env.VITE_API_BASE ?? "";

export const tabs: TabItem[] = [
	{ id: "dashboard", label: "数据面板" },
	{ id: "monitoring", label: "可用性监测" },
	{ id: "channels", label: "渠道管理" },
	{ id: "models", label: "模型广场" },
	{ id: "tokens", label: "令牌管理" },
	{ id: "usage", label: "使用日志" },
	{ id: "settings", label: "系统设置" },
	{ id: "users", label: "用户管理" },
	{ id: "playground", label: "对话测试" },
];

export const userTabs: UserTabItem[] = [
	{ id: "dashboard", label: "仪表盘" },
	{ id: "monitoring", label: "状态" },
	{ id: "models", label: "模型广场" },
	{ id: "tokens", label: "我的令牌" },
	{ id: "usage", label: "使用日志" },
];

export const initialData: AdminData = {
	channels: [],
	tokens: [],
	models: [],
	usage: [],
	dashboard: null,
	monitoring: null,
	settings: null,
};

export const initialChannelForm: ChannelForm = {
	name: "",
	base_url: "",
	api_key: "",
	weight: 1,
	api_format: "openai",
	custom_headers: "",
	models: "",
};

export const initialSettingsForm: SettingsForm = {
	log_retention_days: "30",
	session_ttl_hours: "12",
	admin_password: "",
	registration_mode: "open",
	checkin_reward: "0.5",
	require_invite_code: "false",
	default_balance: "0",
	ldc_payment_enabled: "false",
	ldc_epay_pid: "",
	ldc_epay_key: "",
	ldc_epay_gateway: "https://credit.linux.do/epay",
	ldc_exchange_rate: "0.1",
	announcement: "",
	proxy_extra_headers: "",
	proxy_remove_headers: "",
	model_test_prompt: "",
};
