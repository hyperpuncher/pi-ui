import { normalizeSessionSidebarPreferences } from "../../session-sidebar-types.ts";
import { readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

type SessionSidebarConfig = {
	archive: boolean;
	archiveAfterDays: number;
	open: boolean;
	width: number;
};

function currentSessionSidebar(context: RouteContext): SessionSidebarConfig {
	return {
		archive: context.store.sessionSidebarArchive,
		archiveAfterDays: context.store.sessionSidebarArchiveAfterDays,
		open: context.store.sessionSidebarOpen,
		width: context.store.sessionSidebarWidth,
	};
}

async function persistSessionSidebar(
	context: RouteContext,
	config: SessionSidebarConfig,
): Promise<void> {
	context.store.sessionSidebarArchive = config.archive;
	context.store.sessionSidebarArchiveAfterDays = config.archiveAfterDays;
	context.store.sessionSidebarOpen = config.open;
	context.store.sessionSidebarWidth = config.width;
	await updateAppConfig((appConfig) => {
		appConfig.sessionSidebar = config;
	});
}

export const sessionSidebarRoutes = {
	[endpoints.sessionSidebar]: {
		POST: async (request, context) => {
			const incoming = normalizeSessionSidebarPreferences(
				(await readActionSignals(request)).sessionSidebar,
			);
			const current = currentSessionSidebar(context);
			await persistSessionSidebar(context, {
				archive: incoming.archive ?? current.archive,
				archiveAfterDays: incoming.archiveAfterDays ?? current.archiveAfterDays,
				open: incoming.open ?? current.open,
				width: incoming.width ?? current.width,
			});
			return datastarResponse();
		},
	},
	[endpoints.sessionSidebarArchive]: {
		POST: async (_request, context) => {
			await persistSessionSidebar(context, {
				...currentSessionSidebar(context),
				archive: !context.store.sessionSidebarArchive,
			});
			context.renderer.viewChanged();
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
