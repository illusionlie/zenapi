export type ChannelApiFormat = "openai" | "anthropic" | "custom" | "responses";

export type Channel = {
	id: string;
	name: string;
	base_url: string;
	api_key: string;
	weight: number;
	status: string;
	models_json?: string;
	api_format: ChannelApiFormat;
	custom_headers_json?: string | null;
	/** 伪装请求头（JSON 对象字符串；NULL/空 = 不伪装） */
	disguise_headers_json?: string | null;
	/** 伪装系统提示词（前置注入的首条 system；NULL/空 = 不伪装） */
	disguise_system_prompt?: string | null;
};

export type Token = {
	id: string;
	name: string;
	key_prefix: string;
	quota_total: number | null;
	quota_used: number;
	status: string;
	user_id?: string | null;
	user_name?: string | null;
	user_email?: string | null;
	allowed_channels?: string | null;
	/** 令牌级模型白名单(服务端已还原为数组;null/空数组 = 不限制) */
	allowed_models?: string[] | null;
	created_at?: string | null;
	updated_at?: string | null;
};

export type UsageLog = {
	id: string;
	model: string | null;
	channel_id: string | null;
	channel_name?: string | null;
	token_id: string | null;
	token_name?: string | null;
	user_name?: string | null;
	user_email?: string | null;
	total_tokens: number | null;
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	cost?: number | null;
	latency_ms: number | null;
	first_token_latency_ms?: number | null;
	stream?: boolean | number | null;
	reasoning_effort?: string | number | null;
	status: string;
	created_at: string;
};

export type DashboardData = {
	summary: {
		total_requests: number;
		total_tokens: number;
		avg_latency: number;
		total_errors: number;
	};
	byDay: Array<{ day: string; requests: number; tokens: number }>;
	byModel: Array<{ model: string; requests: number; tokens: number }>;
	byChannel: Array<{ channel_name: string; requests: number; tokens: number }>;
	byToken: Array<{ token_name: string; requests: number; tokens: number }>;
};

export type MonitoringChannelData = {
	channel_id: string;
	channel_name: string;
	channel_status: string;
	api_format: string;
	total_requests: number;
	success_count: number;
	error_count: number;
	success_rate: number | null;
	avg_latency_ms: number;
	last_seen: string | null;
	recent_success_rate: number | null;
	recent_avg_latency_ms: number | null;
};

export type MonitoringDailyTrend = {
	channel_id: string;
	day: string;
	requests: number;
	success: number;
	errors: number;
	success_rate: number;
	avg_latency_ms: number;
};

export type MonitoringErrorDetail = {
	id: string;
	model: string | null;
	channel_id: string | null;
	error_code: number | null;
	error_message: string | null;
	latency_ms: number | null;
	created_at: string;
};

export type MonitoringSlotModel = {
	model: string;
	requests: number;
	success: number;
	errors: number;
	avg_latency_ms: number;
};

export type MonitoringData = {
	summary: {
		total_requests: number;
		total_success: number;
		total_errors: number;
		avg_latency_ms: number;
		success_rate: number;
		active_channels: number;
		total_channels: number;
	};
	recentStatus: {
		total_requests: number;
		total_success: number;
		total_errors: number;
		avg_latency_ms: number;
		success_rate: number;
	};
	channels: MonitoringChannelData[];
	dailyTrends: MonitoringDailyTrend[];
	range: string;
};

export type RegistrationMode = "open" | "linuxdo_only" | "closed";

export type Settings = {
	log_retention_days: number;
	session_ttl_hours: number;
	admin_password_set?: boolean;
	registration_mode: RegistrationMode;
	checkin_reward: number;
	require_invite_code: boolean;
	default_balance: number;
	ldc_payment_enabled: boolean;
	ldc_epay_pid: string;
	ldc_epay_key: string;
	ldc_epay_gateway: string;
	ldc_exchange_rate: number;
	announcement: string;
	proxy_extra_headers: string;
	proxy_remove_headers: string;
	proxy_retry_rounds: number;
	proxy_retry_delay_ms: number;
	model_test_prompt: string;
};

export type ModelChannel = {
	id: string;
	name: string;
	input_price: number | null;
	output_price: number | null;
	avg_latency_ms: number | null;
};

export type ModelItem = {
	id: string;
	real_model_id: string | null;
	channels: ModelChannel[];
	total_requests: number;
	total_tokens: number;
	total_cost: number;
	avg_latency_ms: number | null;
	daily: { day: string; requests: number; tokens: number }[];
};

export type AdminData = {
	channels: Channel[];
	tokens: Token[];
	models: ModelItem[];
	usage: UsageLog[];
	dashboard: DashboardData | null;
	monitoring: MonitoringData | null;
	settings: Settings | null;
};

export type TabId =
	| "dashboard"
	| "monitoring"
	| "channels"
	| "models"
	| "tokens"
	| "usage"
	| "settings"
	| "users"
	| "playground";

export type TabItem = {
	id: TabId;
	label: string;
};

export type ChannelForm = {
	name: string;
	base_url: string;
	api_key: string;
	weight: number;
	api_format: ChannelApiFormat;
	custom_headers: string;
	/** 伪装请求头（JSON 文本，textarea 直读直写；空串 = 不伪装） */
	disguise_headers: string;
	/** 伪装系统提示词（纯文本；空串 = 不伪装） */
	disguise_system_prompt: string;
	models: string;
};

/** 令牌编辑表单(管理台):额度字段以 string 承接 input,提交时转换 */
export type TokenForm = {
	name: string;
	quota_total: string;
	quota_used: string;
	allowed_models: string[];
};

export type SettingsForm = {
	log_retention_days: string;
	session_ttl_hours: string;
	admin_password: string;
	registration_mode: RegistrationMode;
	checkin_reward: string;
	require_invite_code: string;
	default_balance: string;
	ldc_payment_enabled: string;
	ldc_epay_pid: string;
	ldc_epay_key: string;
	ldc_epay_gateway: string;
	ldc_exchange_rate: string;
	announcement: string;
	proxy_extra_headers: string;
	proxy_remove_headers: string;
	proxy_retry_rounds: string;
	proxy_retry_delay_ms: string;
	model_test_prompt: string;
};

export type ModelTestStatus = "pending" | "running" | "success" | "failed";

export type ModelTestResult = {
	status: ModelTestStatus;
	elapsed?: number;
	content?: string;
	error?: string;
};

// User types
export type User = {
	id: string;
	email: string;
	name: string;
	role: string;
	balance: number;
	status: string;
	created_at: string;
	updated_at: string;
	linuxdo_id?: string | null;
	linuxdo_username?: string | null;
	allowed_models?: string[] | null;
};

export type UserDashboardData = {
	balance: number;
	total_requests: number;
	total_tokens: number;
	total_cost: number;
	recent_usage: Array<{ day: string; requests: number; cost: number }>;
	checked_in_today: boolean;
	checkin_reward: number;
	ldc_payment_enabled: boolean;
	ldc_exchange_rate: number;
};

export type UserTabId =
	| "dashboard"
	| "monitoring"
	| "models"
	| "tokens"
	| "usage";

export type UserTabItem = {
	id: UserTabId;
	label: string;
};

export type PublicModelItem = {
	id: string;
	channels: Array<{
		id: string;
		name: string;
		input_price: number | null;
		output_price: number | null;
	}>;
};

export type InviteCode = {
	id: string;
	code: string;
	max_uses: number;
	used_count: number;
	status: string;
	created_by: string | null;
	created_at: string;
};

export type RechargeOrder = {
	id: string;
	out_trade_no: string;
	ldc_amount: number;
	balance_amount: number;
	status: string;
	created_at: string;
};
