import { listRecentDelegations } from "../../agent/delegate-ledger-reader.ts";
import { readLatestWorkflowJournal } from "../../agent/workflow-journal-reader.ts";
import { normalizeLiveWorkspacePreferences } from "../../live-workspace-types.ts";
import {
	renderDelegateLedgerPanel,
	renderWorkflowJournalPanel,
} from "../../ui/live-workspace.tsx";
import { readActionSignals } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import type { RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const liveWorkspaceRoutes = {
	[endpoints.liveWorkspacePreferences]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const preferences = normalizeLiveWorkspacePreferences(
				signals.liveWorkspacePreferences,
			);
			await updateAppConfig((config) => {
				config.liveWorkspace = preferences;
			});
			context.store.setLiveWorkspacePreferences(preferences);
			return datastarResponse();
		},
	},
	[endpoints.liveWorkspaceClearActivity]: {
		POST: async (_request, context) => {
			requireHost(context).clearLiveWorkspaceActivity();
			return datastarResponse();
		},
	},
	[endpoints.liveWorkspaceActivityExport]: {
		GET: (_request, context) => activityExportResponse(context),
	},
	[endpoints.liveWorkspaceWorkflowJournal]: {
		GET: async (_request, context) => {
			const summary = await readLatestWorkflowJournal(context.store.workspacePath);
			return datastarResponse([
				{ type: "elements", elements: renderWorkflowJournalPanel(summary) },
			]);
		},
	},
	[endpoints.liveWorkspaceDelegateLedger]: {
		GET: async () => {
			const entries = await listRecentDelegations();
			return datastarResponse([
				{ type: "elements", elements: renderDelegateLedgerPanel(entries) },
			]);
		},
	},
} satisfies RouteMap<RouteContext>;

/** A plain (non-Datastar) file download: A#-scoped activity export (R2-C). Read-only, so it
 * needs no `requireHost` runtime — it serves straight from the already-tracked `AppStore` state. */
function activityExportResponse(context: RouteContext): Response {
	const activity = context.store.liveWorkspace.activity;
	const body = JSON.stringify(activity, null, 2);
	const filename = `pi-ui-activity-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`;
	return new Response(body, {
		headers: {
			"content-type": "application/json; charset=utf-8",
			"content-disposition": `attachment; filename="${filename}"`,
			"cache-control": "no-store",
		},
	});
}
