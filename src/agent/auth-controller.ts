import { spawn } from "node:child_process";

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
		const modelRegistry = this.getRuntime().session.modelRegistry;
		const authStorage = modelRegistry.authStorage;
		const providers = authStorage
			.list()
			.flatMap((providerId): AppAuthProvider[] => {
				const credential = authStorage.get(providerId);
				return credential
					? [
							{
								id: providerId,
								name: modelRegistry.getProviderDisplayName(providerId),
								authType: credential.type,
							},
						]
					: [];
			})
			.sort(compareAuthProviders);
		this.state.setAuthDialog(
			{ mode: "logout", phase: "providers", providers, progress: [] },
			{ resetInput: true },
		);
	}

	startLogin(providerId: string, authType: string): boolean {
		const provider = this.getLoginProviders().find(
			(candidate) => candidate.id === providerId && candidate.authType === authType,
		);
		if (!provider) return false;
		this.cancelLogin();
		if (provider.authType === "api_key") {
			this.state.setAuthDialog(
				{
					mode: "login",
					phase: "api-key",
					providers: [],
					providerId: provider.id,
					providerName: provider.name,
					progress: [],
				},
				{ resetInput: true },
			);
			return true;
		}
		this.startOAuthLogin(provider);
		return true;
	}

	submitInput(value: string): boolean {
		const dialog = this.state.authDialog;
		if (!dialog) return false;
		if (dialog.phase === "api-key") {
			return this.saveApiKey(dialog, value);
		}

		const run = this.loginRun;
		if (dialog.phase !== "oauth" || !run?.inputResolver) return false;
		if (!value.trim() && !dialog.prompt?.allowEmpty) {
			this.state.setAuthDialog({ ...dialog, error: "A value is required." });
			return false;
		}
		const resolve = run.inputResolver;
		run.inputResolver = undefined;
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
		try {
			this.getRuntime().session.modelRegistry.authStorage.logout(provider.id);
			this.completeAuthentication(
				provider.authType === "oauth"
					? `Logged out of ${provider.name}.`
					: `Removed the stored API key for ${provider.name}.`,
			);
			return true;
		} catch (error) {
			this.state.setAuthDialog({
				...dialog,
				phase: "result",
				error: formatError(error),
			});
			return false;
		}
	}

	close(): void {
		this.cancelLogin();
		this.state.setAuthDialog(undefined, { resetInput: true });
	}

	dispose(): void {
		this.cancelLogin();
	}

	private saveApiKey(dialog: AppAuthDialog, value: string): boolean {
		const apiKey = value.trim();
		if (!apiKey) {
			this.state.setAuthDialog({ ...dialog, error: "API key cannot be empty." });
			return false;
		}
		try {
			this.getRuntime().session.modelRegistry.authStorage.set(dialog.providerId!, {
				type: "api_key",
				key: apiKey,
			});
			this.completeAuthentication(`Saved API key for ${dialog.providerName}.`);
			return true;
		} catch (error) {
			this.state.setAuthDialog({ ...dialog, error: formatError(error) });
			return false;
		}
	}

	private getLoginProviders(): AppAuthProvider[] {
		const session = this.getRuntime().session;
		const oauthProviders = session.modelRegistry.authStorage.getOAuthProviders();
		const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
		const providers: AppAuthProvider[] = oauthProviders.map((provider) => ({
			id: provider.id,
			name: provider.name,
			authType: "oauth",
		}));
		const modelProviderIds = new Set(
			session.modelRegistry.getAll().map((model) => model.provider),
		);
		for (const providerId of modelProviderIds) {
			// Anthropic supports both subscription OAuth and API keys. Other OAuth
			// providers expose subscription-only model namespaces.
			if (oauthProviderIds.has(providerId) && providerId !== "anthropic") continue;
			providers.push({
				id: providerId,
				name: session.modelRegistry.getProviderDisplayName(providerId),
				authType: "api_key",
			});
		}
		return providers.sort(compareAuthProviders);
	}

	private startOAuthLogin(provider: AppAuthProvider): void {
		const authStorage = this.getRuntime().session.modelRegistry.authStorage;
		const oauthProvider = authStorage
			.getOAuthProviders()
			.find((candidate) => candidate.id === provider.id);
		if (!oauthProvider) return;

		const run: AuthLoginRun = {
			id: ++this.loginSequence,
			abortController: new AbortController(),
		};
		this.loginRun = run;
		this.state.setAuthDialog(
			{
				mode: "login",
				phase: "oauth",
				providers: [],
				providerId: provider.id,
				providerName: provider.name,
				status: "Starting authentication…",
				progress: [],
			},
			{ resetInput: true },
		);

		void authStorage
			.login(provider.id, {
				onAuth: (info) => {
					if (!this.isCurrentRun(run)) return;
					openExternalUrl(info.url);
					this.patchOAuthDialog({
						url: info.url,
						instructions: info.instructions,
						status: "Complete authentication in your browser.",
						...(oauthProvider.usesCallbackServer
							? {
									prompt: {
										message:
											"Paste the redirect URL, or complete login in the browser:",
										allowEmpty: false,
									},
								}
							: {}),
					});
				},
				onDeviceCode: (info) => {
					if (!this.isCurrentRun(run)) return;
					openExternalUrl(info.verificationUri);
					this.patchOAuthDialog({
						url: info.verificationUri,
						deviceCode: info.userCode,
						status: "Waiting for authentication…",
					});
				},
				onPrompt: (prompt) => {
					if (!this.isCurrentRun(run)) return Promise.resolve("");
					this.patchOAuthDialog({ prompt, error: undefined });
					return new Promise<string>((resolve) => {
						run.inputResolver = (input) => resolve(input ?? "");
					});
				},
				onProgress: (message) => {
					if (!this.isCurrentRun(run)) return;
					const dialog = this.state.authDialog;
					this.patchOAuthDialog({
						progress: [...(dialog?.progress ?? []), message].slice(-6),
					});
				},
				onManualCodeInput: () => {
					if (!this.isCurrentRun(run)) return Promise.resolve("");
					return new Promise<string>((resolve) => {
						run.inputResolver = (input) => resolve(input ?? "");
					});
				},
				onSelect: (prompt) => {
					if (!this.isCurrentRun(run)) return Promise.resolve(undefined);
					this.patchOAuthDialog({
						prompt: { message: prompt.message, options: prompt.options },
						error: undefined,
					});
					return new Promise<string | undefined>((resolve) => {
						run.inputResolver = resolve;
					});
				},
				signal: run.abortController.signal,
			})
			.then(() => {
				if (!this.isCurrentRun(run)) return;
				this.loginRun = undefined;
				this.completeAuthentication(`Logged in to ${provider.name}.`);
			})
			.catch((error: unknown) => {
				if (!this.isCurrentRun(run)) return;
				this.loginRun = undefined;
				this.patchOAuthDialog({
					phase: "result",
					error: `Login failed: ${formatError(error)}`,
					prompt: undefined,
				});
			});
	}

	private completeAuthentication(status: string): void {
		this.getRuntime().session.modelRegistry.refresh();
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

	private patchOAuthDialog(patch: Partial<AppAuthDialog>): void {
		const dialog = this.state.authDialog;
		if (!dialog || dialog.phase !== "oauth") return;
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
