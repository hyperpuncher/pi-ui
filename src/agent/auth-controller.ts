import { spawn } from "node:child_process";

import type { AuthEvent, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import type { AppAuthDialog, AppAuthProvider, AppStore } from "../state/app-store.ts";

type AuthInputResolver = (value: string | undefined) => void;

type AuthLoginRun = {
	id: number;
	abortController: AbortController;
	inputResolver?: AuthInputResolver;
};

export class AuthController {
	private loginRun: AuthLoginRun | undefined;
	private loginSequence = 0;

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly onAuthChanged: () => void,
	) {}

	openLogin(providerRef?: string): void {
		this.cancelLogin();
		let providers = this.getLoginProviders();
		if (providerRef) {
			const normalized = providerRef.toLowerCase();
			providers = providers.filter(
				(provider) =>
					provider.id.toLowerCase() === normalized ||
					provider.name.toLowerCase() === normalized,
			);
		}
		this.state.setAuthDialog(
			{
				mode: "login",
				phase: "providers",
				providers,
				progress: [],
				...(providerRef && providers.length === 0
					? { error: `Provider not found: ${providerRef}` }
					: {}),
			},
			{ resetInput: true },
		);
	}

	openLogout(): void {
		this.cancelLogin();
		const runtime = this.getRuntime();
		this.state.setAuthDialog(
			{
				mode: "logout",
				phase: "providers",
				providers: [],
				status: "Loading stored credentials…",
				progress: [],
			},
			{ resetInput: true },
		);
		void runtime.services.modelRuntime
			.listCredentials()
			.then((credentials) => {
				const dialog = this.state.authDialog;
				if (!dialog || dialog.mode !== "logout") return;
				const providers = credentials
					.map(
						({ providerId, type }): AppAuthProvider => ({
							id: providerId,
							name:
								runtime.services.modelRuntime.getProvider(providerId)
									?.name ?? providerId,
							authType: type,
						}),
					)
					.sort(compareAuthProviders);
				this.state.setAuthDialog({
					...dialog,
					providers,
					status: undefined,
				});
			})
			.catch((error: unknown) => {
				const dialog = this.state.authDialog;
				if (!dialog || dialog.mode !== "logout") return;
				this.state.setAuthDialog({
					...dialog,
					status: undefined,
					error: formatError(error),
				});
			});
	}

	startLogin(providerId: string, authType: string): boolean {
		if (!isAuthType(authType)) return false;
		const provider = this.getLoginProviders().find(
			(candidate) => candidate.id === providerId && candidate.authType === authType,
		);
		if (!provider) return false;

		const registered = this.getRuntime().services.modelRuntime.getProvider(
			provider.id,
		);
		const method =
			provider.authType === "oauth"
				? registered?.auth.oauth
				: registered?.auth.apiKey;
		if (!method) return false;

		this.cancelLogin();
		if (provider.authType === "api_key" && !method.login) {
			this.state.setAuthDialog(
				{
					mode: "login",
					phase: "result",
					providers: [],
					providerId: provider.id,
					providerName: provider.name,
					status: `${method.name} is configured outside pi-ui.`,
					progress: [],
				},
				{ resetInput: true },
			);
			return true;
		}

		this.startProviderLogin(provider);
		return true;
	}

	submitInput(value: string): boolean {
		const dialog = this.state.authDialog;
		const run = this.loginRun;
		if (
			!dialog ||
			!run?.inputResolver ||
			(dialog.phase !== "api-key" && dialog.phase !== "oauth")
		) {
			return false;
		}
		if (!value.trim()) {
			this.state.setAuthDialog({ ...dialog, error: "A value is required." });
			return false;
		}
		const resolve = run.inputResolver;
		resolve(value);
		this.state.setAuthDialog(
			{
				...dialog,
				prompt: undefined,
				error: undefined,
				status: "Waiting for authentication…",
			},
			{ resetInput: true },
		);
		return true;
	}

	logout(providerId: string): boolean {
		const dialog = this.state.authDialog;
		if (dialog?.mode !== "logout") return false;
		const provider = dialog.providers.find(
			(candidate) => candidate.id === providerId,
		);
		if (!provider) return false;

		const runtime = this.getRuntime();
		void runtime.services.modelRuntime
			.logout(provider.id)
			.then(() => {
				if (this.state.authDialog?.mode !== "logout") return;
				this.completeAuthentication(
					provider.authType === "oauth"
						? `Logged out of ${provider.name}.`
						: `Removed the stored API key for ${provider.name}.`,
				);
			})
			.catch((error: unknown) => {
				const current = this.state.authDialog;
				if (!current || current.mode !== "logout") return;
				this.state.setAuthDialog({
					...current,
					phase: "result",
					error: formatError(error),
				});
			});
		return true;
	}

	close(): void {
		this.cancelLogin();
		this.state.setAuthDialog(undefined, { resetInput: true });
	}

	dispose(): void {
		this.cancelLogin();
	}

	private getLoginProviders(): AppAuthProvider[] {
		const providers: AppAuthProvider[] = [];
		for (const provider of this.getRuntime().services.modelRuntime.getProviders()) {
			if (provider.auth.oauth) {
				providers.push({
					id: provider.id,
					name: provider.name,
					authType: "oauth",
				});
			}
			if (provider.auth.apiKey) {
				providers.push({
					id: provider.id,
					name: provider.name,
					authType: "api_key",
				});
			}
		}
		return providers.sort(compareAuthProviders);
	}

	private startProviderLogin(provider: AppAuthProvider): void {
		const run: AuthLoginRun = {
			id: ++this.loginSequence,
			abortController: new AbortController(),
		};
		this.loginRun = run;
		this.state.setAuthDialog(
			{
				mode: "login",
				phase: provider.authType === "api_key" ? "api-key" : "oauth",
				providers: [],
				providerId: provider.id,
				providerName: provider.name,
				status: "Starting authentication…",
				progress: [],
			},
			{ resetInput: true },
		);

		void this.getRuntime()
			.services.modelRuntime.login(provider.id, provider.authType, {
				signal: run.abortController.signal,
				prompt: (prompt) => this.promptForInput(run, prompt),
				notify: (event) => this.notifyAuthentication(run, event),
			})
			.then(() => {
				if (!this.isCurrentRun(run)) return;
				this.loginRun = undefined;
				this.completeAuthentication(
					provider.authType === "oauth"
						? `Logged in to ${provider.name}.`
						: `Saved credentials for ${provider.name}.`,
				);
			})
			.catch((error: unknown) => {
				if (!this.isCurrentRun(run)) return;
				this.loginRun = undefined;
				this.patchAuthenticationDialog({
					phase: "result",
					error: `Login failed: ${formatError(error)}`,
					prompt: undefined,
				});
			});
	}

	private promptForInput(run: AuthLoginRun, prompt: AuthPrompt): Promise<string> {
		if (!this.isCurrentRun(run)) return Promise.reject(new Error("Login cancelled"));
		if (prompt.signal?.aborted) return Promise.reject(new Error("Login cancelled"));

		this.patchAuthenticationDialog({
			prompt: {
				message: prompt.message,
				placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
				secret: prompt.type === "secret",
				options:
					prompt.type === "select"
						? prompt.options.map(({ id, label }) => ({ id, label }))
						: undefined,
			},
			status: undefined,
			error: undefined,
		});

		return new Promise<string>((resolve, reject) => {
			const finish: AuthInputResolver = (value) => {
				if (run.inputResolver !== finish) return;
				run.inputResolver = undefined;
				prompt.signal?.removeEventListener("abort", cancel);
				if (value === undefined) reject(new Error("Login cancelled"));
				else resolve(value);
			};
			const cancel = () => finish(undefined);
			run.inputResolver = finish;
			prompt.signal?.addEventListener("abort", cancel, { once: true });
		});
	}

	private notifyAuthentication(run: AuthLoginRun, event: AuthEvent): void {
		if (!this.isCurrentRun(run)) return;
		if (event.type === "auth_url") {
			openExternalUrl(event.url);
			this.patchAuthenticationDialog({
				url: event.url,
				instructions: event.instructions,
				status: "Complete authentication in your browser.",
			});
			return;
		}
		if (event.type === "device_code") {
			openExternalUrl(event.verificationUri);
			this.patchAuthenticationDialog({
				url: event.verificationUri,
				deviceCode: event.userCode,
				status: "Waiting for authentication…",
			});
			return;
		}
		if (event.type === "info") {
			this.patchAuthenticationDialog({
				status: event.message,
				url: event.links?.[0]?.url,
			});
			return;
		}
		const dialog = this.state.authDialog;
		this.patchAuthenticationDialog({
			progress: [...(dialog?.progress ?? []), event.message].slice(-6),
		});
	}

	private completeAuthentication(status: string): void {
		this.onAuthChanged();
		const dialog = this.state.authDialog;
		this.state.setAuthDialog(
			{
				mode: dialog?.mode ?? "login",
				phase: "result",
				providers: [],
				providerId: dialog?.providerId,
				providerName: dialog?.providerName,
				status:
					dialog?.mode === "logout"
						? status
						: `${status} Select a model to begin.`,
				progress: [],
			},
			{ resetInput: true },
		);
	}

	private patchAuthenticationDialog(patch: Partial<AppAuthDialog>): void {
		const dialog = this.state.authDialog;
		if (!dialog || (dialog.phase !== "api-key" && dialog.phase !== "oauth")) {
			return;
		}
		this.state.setAuthDialog({ ...dialog, ...patch });
	}

	private isCurrentRun(run: AuthLoginRun): boolean {
		return this.loginRun?.id === run.id;
	}

	private cancelLogin(): void {
		const run = this.loginRun;
		if (!run) return;
		this.loginRun = undefined;
		run.abortController.abort();
		run.inputResolver?.(undefined);
	}
}

function isAuthType(value: string): value is AuthType {
	return value === "oauth" || value === "api_key";
}

function compareAuthProviders(a: AppAuthProvider, b: AppAuthProvider): number {
	const nameComparison = a.name.localeCompare(b.name);
	if (nameComparison !== 0) return nameComparison;
	return a.authType.localeCompare(b.authType);
}

function openExternalUrl(url: string): void {
	const [command, args]: [string, string[]] =
		Deno.build.os === "darwin"
			? ["open", [url]]
			: Deno.build.os === "windows"
				? ["rundll32", ["url.dll,FileProtocolHandler", url]]
				: ["xdg-open", [url]];
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
