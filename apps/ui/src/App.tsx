import "./styles.css";
import { render, useCallback, useEffect, useState } from "hono/jsx/dom";
import { AdminApp } from "./AdminApp";
import { createApiFetch } from "./core/api";
import type { RegistrationMode, User } from "./core/types";
import { LoginView } from "./features/LoginView";
import { PublicApp } from "./PublicApp";
import { UserApp } from "./UserApp";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
	throw new Error("Missing #app root");
}

const normalizePath = (path: string) => {
	if (path.length <= 1) return "/";
	return path.replace(/\/+$/, "") || "/";
};

const App = () => {
	const [adminToken, setAdminToken] = useState<string | null>(() =>
		localStorage.getItem("admin_token"),
	);
	const [userToken, setUserToken] = useState<string | null>(() =>
		localStorage.getItem("user_token"),
	);
	const [userRecord, setUserRecord] = useState<User | null>(null);
	const [userChecked, setUserChecked] = useState(false);
	const [siteInfoLoaded, setSiteInfoLoaded] = useState(false);
	const [registrationMode, setRegistrationMode] =
		useState<RegistrationMode>("open");
	const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
	const [requireInviteCode, setRequireInviteCode] = useState(false);
	const [notice, setNotice] = useState("");
	const [announcement, setAnnouncement] = useState("");
	const [showAnnouncement, setShowAnnouncement] = useState(false);
	const [path, setPath] = useState(() =>
		normalizePath(window.location.pathname),
	);

	const updateAdminToken = useCallback((next: string | null) => {
		setAdminToken(next);
		if (next) {
			localStorage.setItem("admin_token", next);
		} else {
			localStorage.removeItem("admin_token");
		}
	}, []);

	const updateUserToken = useCallback((next: string | null) => {
		setUserToken(next);
		if (next) {
			localStorage.setItem("user_token", next);
		} else {
			localStorage.removeItem("user_token");
			setUserRecord(null);
			setUserChecked(true);
		}
	}, []);

	// Fetch public site info on mount (registration mode, LinuxDO, announcement…)
	useEffect(() => {
		const api = createApiFetch(null, () => {});
		api<{
			registration_mode?: RegistrationMode;
			linuxdo_enabled?: boolean;
			require_invite_code?: boolean;
			announcement?: string;
		}>("/api/public/site-info")
			.then((result) => {
				setRegistrationMode(result.registration_mode ?? "open");
				setLinuxdoEnabled(result.linuxdo_enabled ?? false);
				setRequireInviteCode(result.require_invite_code ?? false);
				const announcementText = result.announcement ?? "";
				setAnnouncement(announcementText);
				if (announcementText) {
					const dismissedKey = `announcement_dismissed_${btoa(encodeURIComponent(announcementText))}`;
					if (!localStorage.getItem(dismissedKey)) {
						setShowAnnouncement(true);
					}
				}
			})
			.catch(() => {})
			.finally(() => setSiteInfoLoaded(true));
	}, []);

	// Load user record when user token is available
	useEffect(() => {
		if (!userToken) {
			setUserRecord(null);
			setUserChecked(true);
			return;
		}
		setUserChecked(false);
		const api = createApiFetch(userToken, () => updateUserToken(null));
		api<{ user: User }>("/api/u/auth/me")
			.then((result) => {
				setUserRecord(result.user);
				setUserChecked(true);
			})
			.catch(() => {
				updateUserToken(null);
			});
	}, [userToken, updateUserToken]);

	useEffect(() => {
		const handlePopState = () => {
			setPath(normalizePath(window.location.pathname));
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	const navigateTo = useCallback((target: string) => {
		history.pushState(null, "", target);
		setPath(normalizePath(target));
	}, []);

	const handleUserLogin = useCallback(
		(token: string) => {
			updateUserToken(token);
			navigateTo("/user");
		},
		[updateUserToken, navigateTo],
	);

	const handleUserLogout = useCallback(() => {
		updateUserToken(null);
		navigateTo("/login");
	}, [updateUserToken, navigateTo]);

	const handleUserRefresh = useCallback(() => {
		if (!userToken) return;
		const api = createApiFetch(userToken, () => updateUserToken(null));
		api<{ user: User }>("/api/u/auth/me")
			.then((result) => {
				setUserRecord(result.user);
			})
			.catch(() => {});
	}, [userToken, updateUserToken]);

	const handleDismissAnnouncement = useCallback(() => {
		if (announcement) {
			const dismissedKey = `announcement_dismissed_${btoa(encodeURIComponent(announcement))}`;
			localStorage.setItem(dismissedKey, "1");
		}
		setShowAnnouncement(false);
	}, [announcement]);

	const handleAdminLogin = useCallback(
		async (event: Event) => {
			event.preventDefault();
			const form = event.currentTarget as HTMLFormElement;
			const formData = new FormData(form);
			const password = String(formData.get("password") ?? "");
			try {
				const api = createApiFetch(null, () => {});
				const result = await api<{ token: string }>("/api/auth/login", {
					method: "POST",
					body: JSON.stringify({ password }),
				});
				updateAdminToken(result.token);
				setNotice("");
			} catch (error) {
				setNotice((error as Error).message);
			}
		},
		[updateAdminToken],
	);

	// Admin routes — always accessible, no need to wait for siteInfo/userCheck
	if (path.startsWith("/admin")) {
		if (!adminToken) {
			return (
				<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
					<LoginView
						notice={notice}
						onSubmit={handleAdminLogin}
						onNavigate={navigateTo}
					/>
				</div>
			);
		}
		return (
			<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
				<AdminApp
					token={adminToken}
					updateToken={updateAdminToken}
					onNavigate={navigateTo}
				/>
			</div>
		);
	}

	// Wait for site info (registration mode etc.) to avoid login form flicker
	if (!siteInfoLoaded) {
		return null;
	}

	// Homepage redirect logic — only when on "/"
	if (path === "/") {
		if (userToken) {
			// Token exists — wait for user check to complete
			if (!userChecked) return null;
			if (userRecord) {
				history.replaceState(null, "", "/user");
				setPath("/user");
				return null;
			}
		}
		// No token or user check failed
		history.replaceState(null, "", "/login");
		setPath("/login");
		return null;
	}

	// User routes
	if (path.startsWith("/user")) {
		if (!userToken) {
			// No token — redirect to login
			history.replaceState(null, "", "/login");
			setPath("/login");
			return (
				<PublicApp
					onUserLogin={handleUserLogin}
					onNavigate={navigateTo}
					linuxdoEnabled={linuxdoEnabled}
					registrationMode={registrationMode}
					requireInviteCode={requireInviteCode}
				/>
			);
		}
		if (!userChecked) {
			// Token exists but still verifying — show nothing to avoid flash
			return null;
		}
		if (!userRecord) {
			// Token was invalid — redirect to login
			history.replaceState(null, "", "/login");
			setPath("/login");
			return (
				<PublicApp
					onUserLogin={handleUserLogin}
					onNavigate={navigateTo}
					linuxdoEnabled={linuxdoEnabled}
					registrationMode={registrationMode}
					requireInviteCode={requireInviteCode}
				/>
			);
		}
		return (
			<div class="min-h-screen bg-linear-to-b from-white via-stone-50 to-stone-100 font-['IBM_Plex_Sans'] text-stone-900 antialiased">
				<UserApp
					token={userToken}
					user={userRecord}
					updateToken={updateUserToken}
					onNavigate={navigateTo}
					linuxdoEnabled={linuxdoEnabled}
					onUserRefresh={handleUserRefresh}
				/>
				{showAnnouncement && announcement && (
					<AnnouncementModal
						text={announcement}
						onClose={handleDismissAnnouncement}
					/>
				)}
			</div>
		);
	}

	// Public routes (/login, /register)
	// If user is already logged in, redirect to /user
	if (userToken && userRecord && (path === "/login" || path === "/register")) {
		history.replaceState(null, "", "/user");
		setPath("/user");
		return null;
	}

	return (
		<>
			<PublicApp
				onUserLogin={handleUserLogin}
				onNavigate={navigateTo}
				linuxdoEnabled={linuxdoEnabled}
				registrationMode={registrationMode}
				requireInviteCode={requireInviteCode}
			/>
			{showAnnouncement && announcement && (
				<AnnouncementModal
					text={announcement}
					onClose={handleDismissAnnouncement}
				/>
			)}
		</>
	);
};

const AnnouncementModal = ({
	text,
	onClose,
}: {
	text: string;
	onClose: () => void;
}) => {
	return (
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div class="mx-4 w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl">
				<div class="mb-4 flex items-center gap-2">
					<span class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-600">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-5 w-5"
							viewBox="0 0 20 20"
							fill="currentColor"
						>
							<path
								fill-rule="evenodd"
								d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z"
								clip-rule="evenodd"
							/>
						</svg>
					</span>
					<h3 class="font-['Space_Grotesk'] text-lg font-semibold tracking-tight text-stone-900">
						站点公告
					</h3>
				</div>
				<div class="mb-5 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
					{text}
				</div>
				<div class="flex justify-end">
					<button
						type="button"
						class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
						onClick={onClose}
					>
						我知道了
					</button>
				</div>
			</div>
		</div>
	);
};

render(<App />, root);
