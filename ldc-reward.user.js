// ==UserScript==
// @name         LINUXDO 打赏助手
// @namespace    tbphp.reward.ldc
// @version      2.0.0
// @description  为 Linux.do 社区帖子添加 LDC 打赏功能，支持 ZenAPI 贡献榜打赏
// @author       @tbphp
// @match        https://linux.do/*
// @match        https://zenapi.top/*
// @match        https://api-worker.metayuandao.workers.dev/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      credit.linux.do
// @run-at       document-idle
// @license      MIT
// ==/UserScript==
//
// 使用说明：
// 1. 安装后，在 linux.do 帖子页面会自动显示打赏按钮
// 2. 若要在 ZenAPI 贡献榜上打赏贡献者，请将上方 @match 中的
//    "http://zenapi.top/*" 替换为您的 ZenAPI 部署地址
//    例如：@match https://api.example.com/*
// 3. 首次使用需配置 LDC 商户凭证（Client ID 和 Client Secret）

(() => {
	// ============================================================================
	// Configuration Constants
	// ============================================================================

	/**
	 * Global configuration object
	 */
	const CONFIG = {
		// Storage key for user credentials
		STORAGE_KEY: "ldc_reward_config",

		// Quick amount options for reward (LDC)
		QUICK_AMOUNTS: [1, 5, 10, 50],

		// Timing configuration (milliseconds)
		TIMING: {
			DEBOUNCE_DELAY: 50,
			URL_CHECK_INTERVAL: 500,
			INITIAL_LOAD_DELAY: 500,
			ROUTE_CHANGE_DELAY: 1000,
			CONFIG_PROMPT_DELAY: 500,
			API_TIMEOUT: 30000,
		},

		// Performance configuration
		PERFORMANCE: {
			BATCH_SIZE: 5, // Number of buttons to process per frame
		},

		// Amount limits
		AMOUNT: {
			MIN: 0.01,
			MAX: 10000,
		},

		// API configuration
		API: {
			ENDPOINT: "https://credit.linux.do/epay/pay/distribute",
			DOCS_URL: "https://credit.linux.do/docs/how-to-use",
		},

		// CSS selectors
		SELECTORS: {
			ARTICLE: "article[data-user-id]",
			LIKE_BUTTON: ".discourse-reactions-reaction-button:not(.my-likes)",
			USER_CARD: "[data-user-card]",
			AVATAR: ".post-avatar img",
			FULL_NAME: ".names .first.full-name a",
			CONTROLS: ".post-controls .actions",
			REWARD_BUTTON: ".reward-button",
		},

		// Regular expressions
		REGEX: {
			TOPIC_PAGE: /^https:\/\/linux\.do\/t\/topic\/\d+/,
		},

		// ZenAPI contribution board selector
		ZENAPI: {
			BOARD_SELECTOR: "#zenapi-contribution-board",
			ROW_SELECTOR: "tr[data-linuxdo-id]",
			BUTTON_CLASS: "zenapi-ldc-reward-btn",
		},
	};

	/**
	 * Style constants for UI elements
	 */
	const STYLES = {
		overlay: `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      backdrop-filter: blur(4px);
    `,

		dialog: `
      background: white;
      padding: 32px;
      border-radius: 12px;
      max-width: 90%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    `,

		input: `
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      box-sizing: border-box;
      font-size: 14px;
      transition: all 0.2s;
      outline: none;
      background: white !important;
      color: #1a1a1a !important;
    `,

		label: `
      display: block;
      margin-bottom: 8px;
      color: #374151;
      font-weight: 500;
      font-size: 14px;
    `,

		buttonBase: `
      padding: 11px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    `,

		buttonCancel: `
      border: 2px solid #e5e7eb;
      background: white;
      color: #6b7280;
    `,

		buttonPrimary: `
      border: none;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(59,130,246,0.3);
    `,

		buttonSuccess: `
      border: none;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(245,158,11,0.3);
    `,

		infoBox: `
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 16px;
    `,

		warningBox: `
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
    `,

		infoBlueBox: `
      background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%);
      border-left: 4px solid #3b82f6;
    `,
	};

	/**
	 * Error type enumeration
	 */
	const ErrorTypes = {
		NETWORK_ERROR: "网络请求失败",
		TIMEOUT_ERROR: "请求超时",
		PARSE_ERROR: "响应解析失败",
		CONFIG_ERROR: "配置错误",
		VALIDATION_ERROR: "参数验证失败",
		API_ERROR: "API 错误",
	};

	// ============================================================================
	// Utils Module - Common utility functions
	// ============================================================================

	const Utils = {
		/**
		 * Generate unique trade number with topic and post information
		 * @param {string} topicId - Topic ID from URL
		 * @param {string} postId - Post ID from article element
		 * @returns {string} Trade number in format LDR_T{topicId}_P{postId}_{timestamp}_{random4digits}
		 */
		generateTradeNo(topicId, postId) {
			const timestamp = Date.now();
			const random = Math.floor(Math.random() * 10000)
				.toString()
				.padStart(4, "0");
			return `LDR_T${topicId}_P${postId}_${timestamp}_${random}`;
		},

		/**
		 * Generate unique trade number for ZenAPI tips
		 * @param {string} userId - LinuxDO user ID
		 * @returns {string} Trade number in format LDR_Z_{userId}_{timestamp}_{random4digits}
		 */
		generateZenApiTradeNo(userId) {
			const timestamp = Date.now();
			const random = Math.floor(Math.random() * 10000)
				.toString()
				.padStart(4, "0");
			return `LDR_Z_${userId}_${timestamp}_${random}`;
		},

		/**
		 * Extract topic ID from current URL
		 * @returns {string|null} Topic ID or null if not found
		 */
		getTopicId() {
			const match = location.href.match(/\/t\/topic\/(\d+)/);
			return match ? match[1] : null;
		},

		/**
		 * Extract post ID from article element
		 * @param {HTMLElement} article - Article element
		 * @returns {string|null} Post ID or null if not found
		 */
		getPostId(article) {
			const id = article.getAttribute("id");
			if (id) {
				const match = id.match(/post_(\d+)/);
				return match ? match[1] : null;
			}
			return null;
		},

		/**
		 * Check if current page is a topic page
		 * @returns {boolean} True if current page matches topic pattern
		 */
		isTopicPage() {
			return CONFIG.REGEX.TOPIC_PAGE.test(location.href);
		},

		/**
		 * Check if current page is on linux.do
		 * @returns {boolean}
		 */
		isLinuxDo() {
			return location.hostname === "linux.do";
		},

		/**
		 * Check if current page has the ZenAPI contribution board
		 * @returns {boolean}
		 */
		hasZenApiBoard() {
			return !!document.querySelector(CONFIG.ZENAPI.BOARD_SELECTOR);
		},

		/**
		 * Unified error handling
		 * @param {string} type - Error type from ErrorTypes
		 * @param {*} details - Error details
		 */
		handleError(type, details) {
			console.error(`[打赏助手] ${type}:`, details);
		},
	};

	// ============================================================================
	// ConfigManager Module - Handle user configuration
	// ============================================================================

	/**
	 * Flag to track if configuration prompt has been shown
	 */
	let hasPromptedConfig = false;

	const ConfigManager = {
		/**
		 * Get stored configuration
		 * @returns {Object|null} Configuration object with client_id and client_secret, or null if not configured
		 */
		get() {
			const config = GM_getValue(CONFIG.STORAGE_KEY);
			return config ? JSON.parse(config) : null;
		},

		/**
		 * Save configuration
		 * @param {string} clientId - Client ID
		 * @param {string} clientSecret - Client Secret
		 */
		save(clientId, clientSecret) {
			GM_setValue(
				CONFIG.STORAGE_KEY,
				JSON.stringify({
					client_id: clientId,
					client_secret: clientSecret,
				}),
			);
		},

		/**
		 * Check if configuration exists
		 * @returns {boolean} True if configured
		 */
		isConfigured() {
			return !!this.get();
		},

		/**
		 * Check and prompt for configuration if needed
		 * @returns {boolean} True if already configured
		 */
		checkAndPrompt() {
			const config = this.get();
			if (!config && !hasPromptedConfig) {
				hasPromptedConfig = true;
				setTimeout(() => {
					if (confirm("检测到您是首次使用打赏功能，是否现在配置？")) {
						UIManager.showConfigDialog();
					}
				}, CONFIG.TIMING.CONFIG_PROMPT_DELAY);
				return false;
			}
			return !!config;
		},
	};

	// ============================================================================
	// RewardAPI Module - Handle reward API calls
	// ============================================================================

	/**
	 * Pending reward requests to prevent duplicates
	 * Key format: "topicId_postId_userId" or "zenapi_userId"
	 */
	const pendingRewards = new Map();

	/**
	 * Clean up expired pending requests (older than 2 minutes)
	 */
	function cleanupExpiredPendingRewards() {
		const now = Date.now();
		const expireTime = 2 * 60 * 1000; // 2 minutes

		for (const [key, value] of pendingRewards.entries()) {
			if (now - value.timestamp > expireTime) {
				pendingRewards.delete(key);
			}
		}
	}

	// Clean up expired locks every minute
	setInterval(cleanupExpiredPendingRewards, 60 * 1000);

	const RewardAPI = {
		/**
		 * Send reward request to API
		 * @param {string} userId - Target user ID
		 * @param {string} username - Target username
		 * @param {number} amount - Reward amount in LDC
		 * @param {string} remark - Remark text
		 * @param {string} topicId - Topic ID (or "zenapi" for ZenAPI tips)
		 * @param {string} postId - Post ID (or linuxdo user ID for ZenAPI tips)
		 * @param {Function} callback - Callback function (success: boolean, message: string) => void
		 */
		sendReward(userId, username, amount, remark, topicId, postId, callback) {
			const config = ConfigManager.get();
			if (!config) {
				callback(false, "请先配置 Client ID 和 Client Secret");
				return;
			}

			// Check for pending request to prevent duplicates
			const requestKey = `${topicId}_${postId}_${userId}`;
			if (pendingRewards.has(requestKey)) {
				callback(false, "该打赏请求正在处理中，请勿重复提交");
				return;
			}

			const auth = btoa(`${config.client_id}:${config.client_secret}`);
			const tradeNo =
				topicId === "zenapi"
					? Utils.generateZenApiTradeNo(userId)
					: Utils.generateTradeNo(topicId, postId);

			// Mark as pending
			pendingRewards.set(requestKey, {
				tradeNo: tradeNo,
				timestamp: Date.now(),
			});

			GM_xmlhttpRequest({
				method: "POST",
				url: CONFIG.API.ENDPOINT,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Basic ${auth}`,
				},
				data: JSON.stringify({
					user_id: parseInt(userId),
					username: username,
					amount: amount,
					out_trade_no: tradeNo,
					remark: remark,
				}),
				onload: (response) => {
					// Remove from pending regardless of result
					pendingRewards.delete(requestKey);

					// Check if response is JSON
					const contentType = response.responseHeaders.match(
						/content-type:\s*([^\r\n;]+)/i,
					);
					const isJSON =
						contentType && contentType[1].includes("application/json");

					// Handle non-2xx status codes
					if (response.status !== 200) {
						const statusText = `HTTP ${response.status}`;
						if (isJSON) {
							try {
								const result = JSON.parse(response.responseText);
								callback(
									false,
									`${statusText}: ${
										result.error_msg || result.message || "请求失败"
									}`,
								);
							} catch (e) {
								callback(
									false,
									`${statusText}: 服务器返回错误，可能配置错误或者超频次。`,
								);
							}
						} else {
							// Non-JSON response (likely HTML error page)
							callback(
								false,
								`${statusText}: 服务器返回错误，可能配置错误或者超频次。`,
							);
						}
						return;
					}

					// Handle 200 response
					try {
						const result = JSON.parse(response.responseText);
						if (!result.error_msg) {
							callback(true, result.data.trade_no);
						} else {
							callback(false, result.error_msg || "未知错误");
						}
					} catch (e) {
						Utils.handleError(ErrorTypes.PARSE_ERROR, e);
						callback(false, "响应解析失败，服务器可能返回了错误页面");
					}
				},
				onerror: (error) => {
					// Remove from pending on error
					pendingRewards.delete(requestKey);
					Utils.handleError(ErrorTypes.NETWORK_ERROR, error);
					callback(false, ErrorTypes.NETWORK_ERROR);
				},
				ontimeout: () => {
					// Remove from pending on timeout
					pendingRewards.delete(requestKey);
					Utils.handleError(ErrorTypes.TIMEOUT_ERROR, "Request timeout");
					callback(false, ErrorTypes.TIMEOUT_ERROR);
				},
				timeout: CONFIG.TIMING.API_TIMEOUT,
			});
		},
	};

	// ============================================================================
	// UIComponents Module - Reusable UI components
	// ============================================================================

	const UIComponents = {
		/**
		 * Create overlay with content
		 * @param {string} content - HTML content
		 * @param {string} width - Dialog width (default: 480px)
		 * @returns {HTMLElement} Overlay element
		 */
		createOverlay(content, width = "480px") {
			const overlay = document.createElement("div");
			overlay.style.cssText = STYLES.overlay;
			overlay.innerHTML = `
        <div style="${STYLES.dialog} width: ${width};">
          ${content}
        </div>
      `;

			// Click outside to close
			overlay.onclick = (e) => {
				if (e.target === overlay) {
					overlay.remove();
				}
			};

			return overlay;
		},

		/**
		 * Create input field component
		 * @param {Object} config - Input configuration
		 * @param {string} config.id - Input element ID
		 * @param {string} config.label - Label text
		 * @param {string} config.type - Input type (default: text)
		 * @param {string} config.placeholder - Placeholder text
		 * @param {string} config.value - Initial value
		 * @param {string} config.attrs - Additional HTML attributes
		 * @returns {string} HTML string
		 */
		createInput(config) {
			return `
        <div style="margin-bottom: 20px;">
          <label style="${STYLES.label}">${config.label}</label>
          <input
            type="${config.type || "text"}"
            id="${config.id}"
            value="${config.value || ""}"
            placeholder="${config.placeholder || ""}"
            style="${STYLES.input}"
            onfocus="this.style.borderColor='${
							config.focusColor || "#3b82f6"
						}'; this.style.boxShadow='0 0 0 3px ${
							config.focusColor
								? config.focusColor.replace("#", "rgba(") + ", 0.1)'"
								: "rgba(59,130,246,0.1)'"
						}"
            onblur="this.style.borderColor='#e5e7eb'; this.style.boxShadow='none'"
            ${config.attrs || ""}
          />
        </div>
      `;
		},

		/**
		 * Create button component
		 * @param {Object} config - Button configuration
		 * @param {string} config.id - Button element ID
		 * @param {string} config.text - Button text
		 * @param {string} config.type - Button type (cancel|primary|success)
		 * @param {string} config.icon - Icon HTML (optional)
		 * @returns {string} HTML string
		 */
		createButton(config) {
			const typeStyles = {
				cancel: STYLES.buttonCancel,
				primary: STYLES.buttonPrimary,
				success: STYLES.buttonSuccess,
			};

			const hoverEffects = {
				cancel:
					"onmouseover=\"this.style.background='#f9fafb'; this.style.borderColor='#d1d5db'\" onmouseout=\"this.style.background='white'; this.style.borderColor='#e5e7eb'\"",
				primary:
					"onmouseover=\"this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(59,130,246,0.4)'\" onmouseout=\"this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(59,130,246,0.3)'\"",
				success:
					"onmouseover=\"this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(245,158,11,0.4)'\" onmouseout=\"this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(245,158,11,0.3)'\"",
			};

			const iconHtml = config.icon ? `<span>${config.icon}</span>` : "";
			const displayStyle = config.icon
				? "display: inline-flex; align-items: center; gap: 6px;"
				: "";

			return `
        <button
          id="${config.id}"
          style="${STYLES.buttonBase} ${
						typeStyles[config.type]
					} ${displayStyle}"
          ${hoverEffects[config.type]}
        >
          ${iconHtml}
          <span>${config.text}</span>
        </button>
      `;
		},

		/**
		 * Create info box component
		 * @param {Object} config - Info box configuration
		 * @param {string} config.type - Box type (warning|info)
		 * @param {string} config.icon - Icon emoji
		 * @param {string} config.title - Title text (optional)
		 * @param {string} config.content - Content text
		 * @param {string} config.linkUrl - Link URL (optional)
		 * @param {string} config.linkText - Link text (optional)
		 * @returns {string} HTML string
		 */
		createInfoBox(config) {
			const boxStyles = {
				warning: STYLES.warningBox,
				info: STYLES.infoBlueBox,
			};

			const textColors = {
				warning: "#92400e",
				info: "#1e3a8a",
			};

			const titleColor = {
				warning: "#92400e",
				info: "#1e40af",
			};

			const titleHtml = config.title
				? `<div style="font-weight: 600; color: ${
						titleColor[config.type]
					}; margin-bottom: 4px; font-size: 14px;">${config.title}</div>`
				: "";

			const linkHtml = config.linkUrl
				? `<a href="${config.linkUrl}" target="_blank" style="color: #2563eb; text-decoration: none; font-weight: 500; font-size: 13px; display: inline-flex; align-items: center; gap: 4px;">${config.linkText} →</a>`
				: "";

			return `
        <div style="${STYLES.infoBox} ${boxStyles[config.type]}">
          <div style="display: flex; align-items: start; gap: 8px;">
            <span style="font-size: ${
							config.type === "warning" ? "16px" : "18px"
						};">${config.icon}</span>
            <div style="flex: 1;">
              ${titleHtml}
              <div style="color: ${
								textColors[config.type]
							}; font-size: 13px; line-height: 1.5; ${
								config.linkUrl ? "margin-bottom: 8px;" : ""
							}">${config.content}</div>
              ${linkHtml}
            </div>
          </div>
        </div>
      `;
		},

		/**
		 * Create user info card
		 * @param {string} userId - User ID
		 * @param {string} username - Username
		 * @param {string} avatarUrl - Avatar URL
		 * @param {string} fullName - Full name or nickname
		 * @returns {string} HTML string
		 */
		createUserCard(userId, username, avatarUrl, fullName) {
			return `
        <div style="display: flex; align-items: center; margin-bottom: 24px; padding: 16px; background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%); border-radius: 10px; border: 1px solid #e5e7eb;">
          <img src="${avatarUrl}" style="width: 56px; height: 56px; border-radius: 50%; margin-right: 14px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" />
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #1a1a1a; font-size: 17px; margin-bottom: 3px;">${fullName}</div>
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 2px;">@${username}</div>
            <div style="font-size: 12px; color: #9ca3af;">User ID: ${userId}</div>
          </div>
        </div>
      `;
		},

		/**
		 * Create user info card without avatar (for ZenAPI contributors)
		 * @param {string} userId - LinuxDO User ID
		 * @param {string} username - LinuxDO username
		 * @param {string} displayName - ZenAPI display name
		 * @returns {string} HTML string
		 */
		createContributorCard(userId, username, displayName) {
			const initials = displayName
				.split(/[\s_-]+/)
				.map((w) => w[0])
				.join("")
				.toUpperCase()
				.slice(0, 2);
			return `
        <div style="display: flex; align-items: center; margin-bottom: 24px; padding: 16px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 10px; border: 1px solid #f59e0b;">
          <div style="width: 56px; height: 56px; border-radius: 50%; margin-right: 14px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); background: linear-gradient(135deg, #f59e0b, #d97706); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 20px;">
            ${initials}
          </div>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #1a1a1a; font-size: 17px; margin-bottom: 3px;">${displayName}</div>
            <div style="font-size: 13px; color: #6b7280; margin-bottom: 2px;">@${username} (Linux DO)</div>
            <div style="font-size: 12px; color: #9ca3af;">Linux DO ID: ${userId}</div>
          </div>
        </div>
      `;
		},
	};

	// ============================================================================
	// UIManager Module - Manage dialogs and UI interactions
	// ============================================================================

	const UIManager = {
		/**
		 * Show configuration dialog
		 */
		showConfigDialog() {
			const config = ConfigManager.get();

			const content = `
        <h2 style="margin: 0 0 24px 0; color: #1a1a1a; font-size: 24px; font-weight: 600;">Linux.do 打赏配置</h2>

        ${UIComponents.createInput({
					id: "reward-client-id",
					label: "Client ID:",
					placeholder: "请输入 Client ID",
					value: config?.client_id || "",
				})}

        ${UIComponents.createInput({
					id: "reward-client-secret",
					label: "Client Secret:",
					type: "password",
					placeholder: "请输入 Client Secret",
					value: config?.client_secret || "",
				})}

        ${UIComponents.createInfoBox({
					type: "info",
					icon: "📖",
					title: "如何获取凭证？",
					content:
						"请访问 Linux.do 商户后台获取您的 Client ID 和 Client Secret",
					linkUrl: CONFIG.API.DOCS_URL,
					linkText: "点击前往文档",
				})}

        ${UIComponents.createInfoBox({
					type: "warning",
					icon: "⚠️",
					content:
						"<strong>安全提示：</strong>请妥善保管您的凭证，不要泄露给他人",
				})}

        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          ${UIComponents.createButton({
						id: "reward-config-cancel",
						text: "取消",
						type: "cancel",
					})}
          ${UIComponents.createButton({
						id: "reward-config-save",
						text: "保存",
						type: "primary",
					})}
        </div>
      `;

			const overlay = UIComponents.createOverlay(content, "480px");
			document.body.appendChild(overlay);

			// Cancel button
			overlay.querySelector("#reward-config-cancel").onclick = () => {
				overlay.remove();
			};

			// Save button
			overlay.querySelector("#reward-config-save").onclick = () => {
				const clientId = overlay
					.querySelector("#reward-client-id")
					.value.trim();
				const clientSecret = overlay
					.querySelector("#reward-client-secret")
					.value.trim();

				if (!clientId || !clientSecret) {
					alert("请填写完整的 Client ID 和 Client Secret");
					return;
				}

				ConfigManager.save(clientId, clientSecret);
				overlay.remove();
			};
		},

		/**
		 * Show reward dialog (for linux.do posts)
		 * @param {string} userId - Target user ID
		 * @param {string} username - Target username
		 * @param {string} avatarUrl - Target user avatar URL
		 * @param {string} fullName - Target user full name or nickname
		 * @param {string} topicId - Topic ID
		 * @param {string} postId - Post ID
		 */
		showRewardDialog(userId, username, avatarUrl, fullName, topicId, postId) {
			const userCard = UIComponents.createUserCard(
				userId,
				username,
				avatarUrl,
				fullName,
			);
			this._showRewardDialogInternal(
				userId,
				username,
				fullName,
				userCard,
				topicId,
				postId,
			);
		},

		/**
		 * Show reward dialog for ZenAPI contributor
		 * @param {string} linuxdoId - LinuxDO user ID
		 * @param {string} linuxdoUsername - LinuxDO username
		 * @param {string} displayName - ZenAPI display name
		 */
		showContributorRewardDialog(linuxdoId, linuxdoUsername, displayName) {
			const userCard = UIComponents.createContributorCard(
				linuxdoId,
				linuxdoUsername,
				displayName,
			);
			this._showRewardDialogInternal(
				linuxdoId,
				linuxdoUsername,
				displayName,
				userCard,
				"zenapi",
				linuxdoId,
			);
		},

		/**
		 * Internal: render the reward dialog with given user card
		 */
		_showRewardDialogInternal(
			userId,
			username,
			fullName,
			userCardHtml,
			topicId,
			postId,
		) {
			const content = `
        <h2 style="margin: 0 0 24px 0; color: #1a1a1a; font-size: 24px; font-weight: 600;">打赏</h2>

        ${userCardHtml}

        <div style="margin-bottom: 20px;">
          <label style="${STYLES.label}">快捷金额：</label>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
            ${CONFIG.QUICK_AMOUNTS.map(
							(amount) => `
              <button class="quick-amount-btn" data-amount="${amount}" style="
                padding: 12px;
                border: 2px solid #e5e7eb;
                background: white;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                color: #374151;
                transition: all 0.2s;
              ">${amount} LDC</button>
            `,
						).join("")}
          </div>
        </div>

        ${UIComponents.createInput({
					id: "reward-amount",
					label: "自定义金额：",
					type: "number",
					placeholder: "请输入金额",
					attrs: `min="${CONFIG.AMOUNT.MIN}" step="0.01"`,
					focusColor: "#f59e0b",
				})}

        ${UIComponents.createInput({
					id: "reward-remark",
					label: "备注（可选）：",
					placeholder: "留下你的祝福...",
					focusColor: "#f59e0b",
				})}

        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          ${UIComponents.createButton({
						id: "reward-cancel",
						text: "取消",
						type: "cancel",
					})}
          ${UIComponents.createButton({
						id: "reward-confirm",
						text: "确认打赏",
						type: "success",
						icon: "💰",
					})}
        </div>
      `;

			const overlay = UIComponents.createOverlay(content, "440px");
			document.body.appendChild(overlay);

			const amountInput = overlay.querySelector("#reward-amount");
			const remarkInput = overlay.querySelector("#reward-remark");

			// Quick amount buttons
			overlay.querySelectorAll(".quick-amount-btn").forEach((btn) => {
				btn.onclick = function () {
					// Reset all buttons
					overlay.querySelectorAll(".quick-amount-btn").forEach((b) => {
						b.style.borderColor = "#e5e7eb";
						b.style.background = "white";
						b.style.color = "#374151";
					});
					// Highlight selected button
					this.style.borderColor = "#f59e0b";
					this.style.background = "#fef3c7";
					this.style.color = "#92400e";
					// Set amount
					amountInput.value = this.dataset.amount;
				};
			});

			// Cancel button
			overlay.querySelector("#reward-cancel").onclick = () => {
				overlay.remove();
			};

			// Confirm button
			overlay.querySelector("#reward-confirm").onclick = () => {
				const amount = parseFloat(amountInput.value);

				// Validation
				if (!amount || amount <= 0) {
					alert("请输入有效的打赏金额");
					return;
				}

				if (amount > CONFIG.AMOUNT.MAX) {
					alert(`单次打赏金额不能超过 ${CONFIG.AMOUNT.MAX} LDC`);
					return;
				}

				// Double confirmation
				if (
					!confirm(`确认向 ${fullName} (@${username}) 打赏 ${amount} LDC？`)
				) {
					return;
				}

				// Disable button to prevent duplicate clicks
				const confirmBtn = overlay.querySelector("#reward-confirm");
				confirmBtn.disabled = true;
				confirmBtn.textContent = "打赏中...";
				confirmBtn.style.background = "#ccc";

				// Build remark - only use user's message
				let remark = remarkInput.value.trim();
				if (remark) {
					remark = `${remark} by @T佬的打赏插件`;
				} else {
					remark = "打赏 by @T佬的打赏插件";
				}

				// Send reward
				RewardAPI.sendReward(
					userId,
					username,
					amount,
					remark,
					topicId,
					postId,
					(success, message) => {
						overlay.remove();
						if (success) {
							alert(`✅ 打赏成功！`);
						} else {
							alert(`❌ 打赏失败\n\n${message}`);
						}
					},
				);
			};
		},
	};

	// ============================================================================
	// DOMManager Module - Handle DOM operations and button injection (linux.do)
	// ============================================================================

	/**
	 * Current URL for tracking route changes
	 */
	let currentUrl = location.href;

	/**
	 * Debounce timer
	 */
	let debounceTimer = null;

	const DOMManager = {
		/**
		 * Add reward buttons to all posts
		 */
		addRewardButtons() {
			// 1. 仅在帖子详情页执行
			if (!Utils.isTopicPage()) {
				return;
			}

			// 2. 获取所有帖子元素
			const articles = document.querySelectorAll(CONFIG.SELECTORS.ARTICLE);

			articles.forEach((article) => {
				// --- 核心修复：更严格的检查逻辑 ---

				// 找到操作栏容器
				const controls = article.querySelector(CONFIG.SELECTORS.CONTROLS);
				if (!controls) {
					return;
				}

				// 检查 1: 如果容器里已经有打赏按钮了，直接跳过 (防止重复)
				if (controls.querySelector(CONFIG.SELECTORS.REWARD_BUTTON)) {
					return;
				}

				// 检查 2: 如果找不到点赞按钮，说明可能是系统消息或特殊帖子，跳过
				const likeButton = article.querySelector(CONFIG.SELECTORS.LIKE_BUTTON);
				if (!likeButton) {
					return;
				}
				const userId = article.getAttribute("data-user-id");
				const usernameElement = article.querySelector(
					CONFIG.SELECTORS.USER_CARD,
				);
				const username = usernameElement?.getAttribute("data-user-card");
				const avatarElement = article.querySelector(CONFIG.SELECTORS.AVATAR);
				const avatarUrl = avatarElement?.src;

				// Get full name (prefer display name, fallback to username)
				const fullNameElement = article.querySelector(
					CONFIG.SELECTORS.FULL_NAME,
				);
				const fullName = fullNameElement?.textContent?.trim() || username;

				// Get topic ID and post ID
				const topicId = Utils.getTopicId();
				const postId = Utils.getPostId(article);

				if (!userId || !username || !topicId || !postId) {
					return;
				}

				// Create reward button
				const rewardBtn = document.createElement("button");
				rewardBtn.className = "reward-button btn btn-icon-text btn-flat";
				rewardBtn.innerHTML = `
            <svg class="fa d-icon d-icon-coins svg-icon svg-string" style="width: 16px; height: 16px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
              <path fill="currentColor" d="M512 80c0 18-14.3 34.6-38.4 48c-29.1 16.1-72.5 27.5-122.3 30.9c-3.7-1.8-7.4-3.5-11.3-5C300.6 137.4 248.2 128 192 128c-8.3 0-16.4 .2-24.5 .6l-1.1-.6C142.3 114.6 128 98 128 80c0-44.2 86-80 192-80S512 35.8 512 80zM160.7 161.1c10.2-.7 20.7-1.1 31.3-1.1c62.2 0 117.4 12.3 152.5 31.4C369.3 204.9 384 221.7 384 240c0 4-.7 7.9-2.1 11.7c-4.6 13.2-17 25.3-35 35.5c0 0 0 0 0 0c-.1 .1-.3 .1-.4 .2l0 0 0 0c-.3 .2-.6 .3-.9 .5c-35 19.4-90.8 32-153.6 32c-59.6 0-112.9-11.3-148.2-29.1c-1.9-.9-3.7-1.9-5.5-2.9C14.3 274.6 0 258 0 240c0-34.8 53.4-64.5 128-75.4c10.5-1.5 21.4-2.7 32.7-3.5zM416 240c0-21.9-10.6-39.9-24.1-53.4c28.3-4.4 54.2-11.4 76.2-20.5c16.3-6.8 31.5-15.2 43.9-25.5V176c0 19.3-16.5 37.1-43.8 50.9c-14.6 7.4-32.4 13.7-52.4 18.5c.1-1.8 .2-3.5 .2-5.3zm-32 96c0 18-14.3 34.6-38.4 48c-1.8 1-3.6 1.9-5.5 2.9C304.9 404.7 251.6 416 192 416c-62.8 0-118.6-12.6-153.6-32C14.3 370.6 0 354 0 336V300.6c12.5 10.3 27.6 18.7 43.9 25.5C83.4 342.6 135.8 352 192 352s108.6-9.4 148.1-25.9c7.8-3.2 15.3-6.9 22.4-10.9c6.1-3.4 11.8-7.2 17.2-11.2c1.5-1.1 2.9-2.3 4.3-3.4V304v5.7V336zm32 0V304 278.1c19-4.2 36.5-9.5 52.1-16c16.3-6.8 31.5-15.2 43.9-25.5V272c0 10.5-5 21-14.9 30.9c-16.3 16.3-45 29.7-81.3 38.4c.1-1.7 .2-3.5 .2-5.3zM192 448c56.2 0 108.6-9.4 148.1-25.9c16.3-6.8 31.5-15.2 43.9-25.5V432c0 44.2-86 80-192 80S0 476.2 0 432V396.6c12.5 10.3 27.6 18.7 43.9 25.5C83.4 438.6 135.8 448 192 448z"/>
        </svg>
        <span class="d-button-label">打赏</span>
        `;
				rewardBtn.style.cssText = `
          color: #f59e0b;
          margin-left: 5px;
          display: flex; /* 确保图标对齐 */
          align-items: center;
        `;
				rewardBtn.title = `打赏 ${fullName}`;

				rewardBtn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();
					const config = ConfigManager.get();
					if (!config) {
						if (confirm("您还未配置打赏凭证，是否现在配置？")) {
							UIManager.showConfigDialog();
						}
						return;
					}
					UIManager.showRewardDialog(
						userId,
						username,
						avatarUrl,
						fullName,
						topicId,
						postId,
					);
				};

				// 插入按钮到第一个位置
				controls.insertBefore(rewardBtn, controls.firstChild);
			});
		},

		/**
		 * Debounced version of addRewardButtons
		 */
		debouncedAddRewardButtons() {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				this.addRewardButtons();
			}, CONFIG.TIMING.DEBOUNCE_DELAY);
		},

		/**
		 * Watch for URL changes (for SPA routing)
		 */
		watchUrlChange() {
			setInterval(() => {
				if (currentUrl !== location.href) {
					currentUrl = location.href;

					// Delay to wait for page rendering
					setTimeout(() => {
						DOMManager.addRewardButtons();
					}, CONFIG.TIMING.ROUTE_CHANGE_DELAY);
				}
			}, CONFIG.TIMING.URL_CHECK_INTERVAL);
		},
	};

	// ============================================================================
	// ZenApiManager Module - Handle ZenAPI contribution board integration
	// ============================================================================

	let zenApiDebounceTimer = null;

	const ZenApiManager = {
		/**
		 * Add LDC reward buttons to ZenAPI contribution board rows.
		 * Detects <tr> elements with data-linuxdo-id and data-linuxdo-username
		 * attributes inside the #zenapi-contribution-board table.
		 */
		addContributionButtons() {
			const board = document.querySelector(CONFIG.ZENAPI.BOARD_SELECTOR);
			if (!board) return;

			const rows = board.querySelectorAll(CONFIG.ZENAPI.ROW_SELECTOR);
			rows.forEach((row) => {
				// Skip if button already added
				if (row.querySelector(`.${CONFIG.ZENAPI.BUTTON_CLASS}`)) return;

				const linuxdoId = row.getAttribute("data-linuxdo-id");
				const linuxdoUsername = row.getAttribute("data-linuxdo-username");
				const contributorName =
					row.getAttribute("data-contributor-name") || "贡献者";

				if (!linuxdoId || !linuxdoUsername) return;

				// Find the contributor name cell (second td)
				const nameTd = row.querySelectorAll("td")[1];
				if (!nameTd) return;

				// Create the LDC reward badge button
				const btn = document.createElement("button");
				btn.className = CONFIG.ZENAPI.BUTTON_CLASS;
				btn.textContent = "LDC 打赏";
				btn.style.cssText = `
          margin-left: 6px;
          display: inline-flex;
          align-items: center;
          padding: 1px 6px;
          border-radius: 9999px;
          border: none;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          vertical-align: middle;
          line-height: 1.6;
        `;

				btn.onmouseover = function () {
					this.style.transform = "translateY(-1px)";
					this.style.boxShadow = "0 2px 8px rgba(245,158,11,0.4)";
				};
				btn.onmouseout = function () {
					this.style.transform = "translateY(0)";
					this.style.boxShadow = "none";
				};

				btn.onclick = (e) => {
					e.preventDefault();
					e.stopPropagation();

					const config = ConfigManager.get();
					if (!config) {
						if (confirm("您还未配置 LDC 打赏凭证，是否现在配置？")) {
							UIManager.showConfigDialog();
						}
						return;
					}

					UIManager.showContributorRewardDialog(
						linuxdoId,
						linuxdoUsername,
						contributorName,
					);
				};

				nameTd.appendChild(btn);
			});
		},

		/**
		 * Debounced version of addContributionButtons
		 */
		debouncedAddContributionButtons() {
			clearTimeout(zenApiDebounceTimer);
			zenApiDebounceTimer = setTimeout(() => {
				this.addContributionButtons();
			}, CONFIG.TIMING.DEBOUNCE_DELAY);
		},
	};

	// ============================================================================
	// Initialization
	// ============================================================================

	/**
	 * Initialize the reward assistant
	 */
	function init() {
		console.log("[打赏助手] 初始化");

		const isOnLinuxDo = Utils.isLinuxDo();

		// Check and prompt for config on first use (only on linux.do)
		if (isOnLinuxDo) {
			ConfigManager.checkAndPrompt();
		}

		if (isOnLinuxDo) {
			// === Linux DO mode ===
			// Add buttons immediately on topic pages
			if (Utils.isTopicPage()) {
				setTimeout(() => {
					DOMManager.addRewardButtons();
				}, CONFIG.TIMING.INITIAL_LOAD_DELAY);
			}

			// Watch for URL changes (SPA routing)
			DOMManager.watchUrlChange();

			// Watch for dynamic content loading
			const observer = new MutationObserver(() => {
				DOMManager.debouncedAddRewardButtons();
			});

			observer.observe(document.body, {
				childList: true,
				subtree: true,
			});
		} else {
			// === ZenAPI mode ===
			// Try to add buttons immediately
			setTimeout(() => {
				ZenApiManager.addContributionButtons();
			}, CONFIG.TIMING.INITIAL_LOAD_DELAY);

			// Watch for dynamic content (SPA)
			const observer = new MutationObserver(() => {
				ZenApiManager.debouncedAddContributionButtons();
			});

			observer.observe(document.body, {
				childList: true,
				subtree: true,
			});
		}
	}

	// ============================================================================
	// Bootstrap
	// ============================================================================

	// Register menu command
	GM_registerMenuCommand("配置打赏凭证", () => {
		UIManager.showConfigDialog();
	});

	// Start when page is ready
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init);
	} else {
		init();
	}
})();
