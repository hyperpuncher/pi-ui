import type { RuntimeController } from "#src/agent/runtime-controller.ts";
import type { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import { RouteError } from "#src/server/route.ts";
import type { SessionImageStore } from "#src/server/session-image-store.ts";
import type { TransferredFileStore } from "#src/server/transferred-files.ts";
import type { AppStore } from "#src/state/app-store.ts";
import type { UiRenderer } from "#src/ui/ui-renderer.ts";

export interface RouteResources {
	fdPath?: string;
	host: RuntimeController | undefined;
	sessionImages: SessionImageStore;
}

export interface RouteContext {
	clientAddress?: string;
	appVersion: string;
	themeLab: boolean;
	store: AppStore;
	renderer: UiRenderer;
	notificationClients: DatastarClientHub;
	resources: RouteResources;
	transferredFiles: Pick<TransferredFileStore, "importFiles">;
	openWorkspace(path: string): Promise<boolean>;
	serveStatic(request: Request): Promise<Response>;
}

export function requireHost(context: RouteContext): RuntimeController {
	if (!context.resources.host) {
		throw new RouteError(503, "Session runtime unavailable.");
	}
	return context.resources.host;
}
