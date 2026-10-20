import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SessionTransitionResult } from "#src/agent/session-transition-controller.ts";
import { thumbnailImage, type ThumbnailImage } from "#src/image-resize.ts";
import {
	readActionSignals,
	requiredString,
	stringField,
} from "#src/server/action-input.ts";
import {
	datastarResponse,
	errorResponse,
	signalsResponse,
} from "#src/server/datastar.ts";
import { RouteError, type RouteMap } from "#src/server/route.ts";
import { requireHost, type RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import { decodeBase64Image } from "#src/server/session-image-store.ts";
import type { StoredSessionImage } from "#src/server/session-image-store.ts";
import { BoundedCache } from "#src/ui/render-cache.ts";
import { expandHomePath } from "#src/utils/workspace.ts";

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
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			context.renderer.setSessionSearch(stringField(signals, "sessionSearch"));
			return datastarResponse();
		},
	},
	[endpoints.sessionsMore]: {
		POST: (_request, context) => {
			context.store.loadMoreSessions();
			return datastarResponse();
		},
	},
	[endpoints.sessionsImage]: {
		GET: async (_request, context, url) => {
			const image = context.resources.sessionImages.get(
				url.searchParams.get("id") ?? "",
			);
			if (!image) throw new RouteError(404, "Session image not found.");
			if (!url.searchParams.has("thumb")) {
				return new Response(decodeBase64Image(image.data), {
					headers: {
						"cache-control": "private, max-age=3600",
						"content-type": image.mimeType,
						"x-content-type-options": "nosniff",
					},
				});
			}
			const thumbnail = await sessionThumbnail(
				url.searchParams.get("id") ?? "",
				image,
			);
			// Unresizable sources (tiny, animated, exotic) fall back to full.
			const body: { data: Uint8Array<ArrayBuffer>; mimeType: string } =
				thumbnail ?? {
					data: decodeBase64Image(image.data),
					mimeType: image.mimeType,
				};
			return new Response(body.data, {
				headers: {
					"cache-control": "private, max-age=3600",
					"content-type": body.mimeType,
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
				? new Response(favicon, { headers: faviconHeaders(favicon.type) })
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
				{ type: "effect", effect: { type: "focus-session-picker" } },
			]);
		},
	},
	[endpoints.sessionsResume]: {
		POST: async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"sessionPath",
			).trim();
			const host = requireHost(context);
			if (path === context.store.currentSessionPath)
				return signalsResponse({ _sessionTransitionPending: false });
			return sessionTransitionResponse(await host.resumeSession(path));
		},
	},
	[endpoints.sessionsPrevious]: {
		POST: async (_request, context) => {
			const path = context.store.previousSessionPath;
			// The shortcut is a no-op until a persisted session has been switched away from.
			if (!path) return datastarResponse();
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

const sessionThumbnails = new BoundedCache<string, ThumbnailImage>(200);

async function sessionThumbnail(
	id: string,
	image: StoredSessionImage,
): Promise<ThumbnailImage | undefined> {
	const cached = sessionThumbnails.get(id);
	if (cached) return cached;
	const thumbnail = await thumbnailImage(decodeBase64Image(image.data), image.mimeType);
	if (!thumbnail) return undefined;
	sessionThumbnails.set(id, thumbnail);
	return thumbnail;
}

const FAVICON_DIRECTORIES = [
	"",
	"public",
	"static",
	"site",
	"site/public",
	"site/static",
	"app",
	"src/app",
] as const;
const FAVICON_EXTENSIONS = ["ico", "svg", "png"] as const;

const FOLDER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><style>:root{color:#737373}@media(prefers-color-scheme:dark){:root{color:#a1a1aa}}</style><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;

async function readWorkspaceFavicon(cwd: string): Promise<Bun.BunFile | undefined> {
	for (const directory of FAVICON_DIRECTORIES) {
		for (const extension of FAVICON_EXTENSIONS) {
			const file = Bun.file(join(cwd, directory, `favicon.${extension}`));
			if (await file.exists()) return file;
		}
	}

	return undefined;
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
