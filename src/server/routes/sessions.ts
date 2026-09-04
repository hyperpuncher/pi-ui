import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SessionTransitionResult } from "../../agent/session-transition-controller.ts";
import { renderSessionPickerContent } from "../../ui/pickers.tsx";
import { expandHomePath } from "../../utils/workspace.ts";
import { readActionSignals, requiredString, stringField } from "../action-input.ts";
import { datastarResponse, errorResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import { decodeBase64Image } from "../session-image-store.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const sessionRoutes = {
	[endpoints.sessionsNew]: {
		POST: async (_request, context) =>
			sessionTransitionResponse(await requireHost(context).newSession()),
	},
	[endpoints.sessionsNewTemporary]: {
		POST: async (_request, context) =>
			sessionTransitionResponse(await requireHost(context).newTemporarySession()),
	},
	[endpoints.sessionsSearch]: {
		GET: async (request, context) => {
			const query = stringField(await readActionSignals(request), "sessionSearch");
			return datastarResponse([
				{
					type: "elements",
					elements: renderSessionPickerContent({
						activityText: context.store.activityText,
						currentSessionPath: context.store.currentSessionPath,
						sessions: context.store.searchSessions(query),
						sessionsHasMore: context.store.sessionsHasMore,
					}),
				},
				{ type: "effect", effect: { type: "refresh-session-picker" } },
			]);
		},
	},
	[endpoints.sessionsMore]: {
		POST: (_request, context) => {
			context.store.loadMoreSessions();
			return datastarResponse();
		},
	},
	[endpoints.sessionsImage]: {
		GET: (_request, context, url) => {
			const image = context.resources.sessionImages.get(
				url.searchParams.get("id") ?? "",
			);
			if (!image) throw new RouteError(404, "Session image not found.");
			return new Response(decodeBase64Image(image.data), {
				headers: {
					"cache-control": "private, max-age=3600",
					"content-type": image.mimeType,
					"x-content-type-options": "nosniff",
				},
			});
		},
	},
	[endpoints.sessionsFavicon]: {
		GET: async (_request, context, url) => {
			const cwd = url.searchParams.get("cwd");
			const knownWorkspace = context.store
				.getSessionCatalog()
				.some((candidate) => candidate.cwd === cwd);
			if (!cwd || !knownWorkspace) return folderIconResponse();

			const favicon = await readWorkspaceFavicon(cwd);
			return favicon
				? new Response(favicon.bytes, {
						headers: faviconHeaders(favicon.contentType),
					})
				: folderIconResponse();
		},
	},
	[endpoints.sessionsBackgroundAbort]: {
		POST: async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"backgroundSessionPath",
			);
			if (!(await requireHost(context).abortBackgroundSession(path))) {
				throw new RouteError(409, "Background session could not be aborted.");
			}
			return signalsResponse({ backgroundSessionPath: "" });
		},
	},
	[endpoints.sessionsRename]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const path = requiredString(signals, "sessionRenamePath");
			const title = requiredString(signals, "sessionRenameTitle");
			if (!(await requireHost(context).renameSession(path, title))) {
				throw new RouteError(409, "Session could not be renamed.");
			}
			return signalsResponse({ sessionRenamePath: "", sessionRenameTitle: "" });
		},
	},
	[endpoints.sessionsDelete]: {
		POST: async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"sessionDeletePath",
			);
			if (!(await requireHost(context).deleteSession(path))) {
				throw new RouteError(409, "Session could not be deleted.");
			}
			return datastarResponse([
				{
					type: "signals",
					signals: { sessionDeletePath: "", sessionDeleteTitle: "" },
				},
				{ type: "effect", effect: { type: "session-deleted" } },
			]);
		},
	},
	[endpoints.sessionsResume]: {
		POST: async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"sessionPath",
			).trim();
			return sessionTransitionResponse(
				await requireHost(context).resumeSession(path),
			);
		},
	},
	[endpoints.sessionsForkToWorkspace]: {
		POST: async (request, context) => {
			const requestedPath = requiredString(
				await readActionSignals(request),
				"workspacePath",
			).trim();
			const workspacePath = await realpath(expandHomePath(requestedPath));
			if (!(await stat(workspacePath)).isDirectory()) {
				throw new RouteError(422, "Workspace is not a directory.");
			}
			return sessionTransitionResponse(
				await requireHost(context).forkSessionToWorkspace(workspacePath),
			);
		},
	},
} satisfies RouteMap<RouteContext>;

const FAVICON_CANDIDATES = [
	"favicon.ico",
	"favicon.svg",
	"favicon.png",
	"public/favicon.ico",
	"public/favicon.svg",
	"public/favicon.png",
	"static/favicon.ico",
	"static/favicon.svg",
	"static/favicon.png",
	"app/favicon.ico",
	"app/favicon.svg",
	"app/favicon.png",
	"src/app/favicon.ico",
	"src/app/favicon.svg",
	"src/app/favicon.png",
] as const;

const FAVICON_CONTENT_TYPES = new Map<string, string>(
	Object.entries({
		ico: "image/x-icon",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		svg: "image/svg+xml",
		webp: "image/webp",
	}),
);

const FOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><style>:root{color:#737373}@media(prefers-color-scheme:dark){:root{color:#a1a1aa}}</style><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

async function readWorkspaceFavicon(
	cwd: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | undefined> {
	for (const candidate of FAVICON_CANDIDATES) {
		const favicon = await readFaviconFile(join(cwd, candidate));
		if (favicon) return favicon;
	}

	return undefined;
}

async function readFaviconFile(
	path: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | undefined> {
	try {
		const file = Bun.file(path);
		if (!(await file.exists())) return undefined;
		const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
		return {
			bytes: await file.arrayBuffer(),
			contentType:
				FAVICON_CONTENT_TYPES.get(extension) ?? "application/octet-stream",
		};
	} catch {
		return undefined;
	}
}

function faviconHeaders(contentType: string): HeadersInit {
	return {
		"cache-control": "private, max-age=300",
		"content-type": contentType,
		"x-content-type-options": "nosniff",
	};
}

function folderIconResponse(): Response {
	return new Response(FOLDER_ICON, {
		headers: faviconHeaders("image/svg+xml; charset=utf-8"),
	});
}

export function sessionTransitionResponse(result: SessionTransitionResult): Response {
	switch (result.status) {
		case "success":
			return datastarResponse();
		case "busy":
			return errorResponse(409, "A session transition is already running.");
		case "cancelled":
			return errorResponse(422, "Session transition was cancelled.");
		case "error":
			return errorResponse(500, "Session transition failed.");
	}
}
