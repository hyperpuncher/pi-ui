import type { AppStore } from "../state/app-store.ts";
import { defaultWorkspacePath } from "../utils/workspace.ts";
import {
	RuntimeController,
	type RuntimeControllerActivationOptions,
} from "./runtime-controller.ts";
import type { SessionTransitionResult } from "./session-transition-controller.ts";

/** Route-facing facade. Runtime and domain ownership live in focused controllers. */
export class AgentHost {
	private constructor(private readonly runtime: RuntimeController) {}

	static async create(
		state: AppStore,
		cwd = defaultWorkspacePath(),
		options: RuntimeControllerActivationOptions = {},
	): Promise<AgentHost> {
		const host = await AgentHost.prepare(state, cwd, options);
		host.activate();
		return host;
	}

	static async prepare(
		state: AppStore,
		cwd = defaultWorkspacePath(),
		options: RuntimeControllerActivationOptions = {},
	): Promise<AgentHost> {
		return new AgentHost(await RuntimeController.prepare(state, cwd, options));
	}

	activate(): void {
		this.runtime.activate();
	}

	prompt(
		text: string,
		options: { streamingBehavior?: "steer" | "followUp" } = {},
	): Promise<boolean> {
		return this.runtime.prompt(text, options);
	}

	abort(): Promise<void> {
		return this.runtime.abort();
	}

	abortBackgroundSession(sessionPath: string): Promise<boolean> {
		return this.runtime.abortBackgroundSession(sessionPath);
	}

	restoreQueuedMessages(): string {
		return this.runtime.restoreQueuedMessages();
	}

	newSession(): Promise<SessionTransitionResult> {
		return this.runtime.newSession();
	}

	newTemporarySession(): Promise<SessionTransitionResult> {
		return this.runtime.newTemporarySession();
	}

	listSessions(): Promise<void> {
		return this.runtime.listSessions();
	}

	deleteSession(sessionPath: string): Promise<boolean> {
		return this.runtime.deleteSession(sessionPath);
	}

	getWorkspacePath(): string {
		return this.runtime.getWorkspacePath();
	}

	resumeSession(sessionPath: string): Promise<SessionTransitionResult> {
		return this.runtime.resumeSession(sessionPath);
	}

	openTree(): boolean {
		return this.runtime.openTree();
	}

	navigateTree(
		entryId: string,
		options: { summarize?: boolean; customInstructions?: string } = {},
	): Promise<string | undefined> {
		return this.runtime.navigateTree(entryId, options);
	}

	setThinkingLevel(level: string): Promise<boolean> {
		return this.runtime.setThinkingLevel(level);
	}

	cycleThinkingLevel(direction: "forward" | "backward" = "forward"): boolean {
		return this.runtime.cycleThinkingLevel(direction);
	}

	compact(customInstructions?: string): Promise<boolean> {
		return this.runtime.compact(customInstructions);
	}

	openLogin(providerRef?: string): void {
		this.runtime.openLogin(providerRef);
	}

	openLogout(): void {
		this.runtime.openLogout();
	}

	startLogin(providerId: string, authType: string): boolean {
		return this.runtime.startLogin(providerId, authType);
	}

	submitAuthInput(value: string): boolean {
		return this.runtime.submitAuthInput(value);
	}

	logout(providerId: string): boolean {
		return this.runtime.logout(providerId);
	}

	closeAuth(): void {
		this.runtime.closeAuth();
	}

	setModel(modelRef: string): Promise<boolean> {
		return this.runtime.setModel(modelRef);
	}

	cycleModel(direction: "forward" | "backward" = "forward"): Promise<boolean> {
		return this.runtime.cycleModel(direction);
	}

	toggleScopedModel(modelRef: string): Promise<boolean> {
		return this.runtime.toggleScopedModel(modelRef);
	}

	dispose(): Promise<void> {
		return this.runtime.dispose();
	}
}
