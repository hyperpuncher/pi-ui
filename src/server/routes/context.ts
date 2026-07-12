import type { AgentHost } from "../../agent/host.ts";
import type { AppStore } from "../../state/app-store.ts";
import type { UiRenderer } from "../../ui/ui-renderer.ts";
import type { FileSearchHost } from "../file-search.ts";
import { RouteError } from "../router.ts";
import type { TransferredFileStore } from "../transferred-files.ts";

export type RouteAgentHost = Pick<
	AgentHost,
	| "abort"
	| "abortBackgroundSession"
	| "closeAuth"
	| "cycleModel"
	| "cycleThinkingLevel"
	| "deleteSession"
	| "getWorkspacePath"
	| "listSessions"
	| "logout"
	| "navigateTree"
	| "newSession"
	| "newTemporarySession"
	| "openLogin"
	| "openLogout"
	| "openTree"
	| "prompt"
	| "restoreQueuedMessages"
	| "resumeSession"
	| "setModel"
	| "setThinkingLevel"
	| "startLogin"
	| "submitAuthInput"
	| "toggleScopedModel"
>;

export interface RouteResources {
	host: AgentHost | undefined;
	fileSearch: FileSearchHost;
}

export interface RouteContext {
	store: AppStore;
	renderer: UiRenderer;
	resources: RouteResources;
	transferredFiles: TransferredFileStore;
	openWorkspace(path: string): Promise<boolean>;
	readBasecoat(): Promise<ArrayBuffer>;
	serveStatic(request: Request): Promise<Response>;
}

export function requireHost(context: RouteContext): RouteAgentHost {
	if (!context.resources.host) {
		throw new RouteError(503, "Session runtime unavailable.");
	}
	return context.resources.host;
}
