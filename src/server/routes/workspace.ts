import { basename, dirname, extname, join } from "node:path";

import { renderMarkdownFinal } from "../../ui/markdown.tsx";
import {
	renderWorkspaceBrowserContent,
	renderWorkspaceBrowserError,
	renderWorkspaceSearchResults,
} from "../../ui/pickers.tsx";
import {
	renderWorktreeDialogContent,
	renderWorktreeIgnoredPaths,
} from "../../ui/worktree-dialog.tsx";
import { isRecord, isString } from "../../utils/type-guards.ts";
import { formatHomePath } from "../../utils/workspace.ts";
import {
	booleanField,
	readActionSignals,
	requiredString,
	stringField,
} from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import {
	createGitBranch,
	createGitWorktree,
	deleteGitBranch,
	GitWorktreeError,
	ignoredWorktreePaths,
	inspectGitWorktrees,
	removeGitWorktree,
	switchGitBranch,
} from "../git-worktrees.ts";
import { RouteError, type RouteMap } from "../route.ts";
import {
	createWorkspaceEntry,
	listWorkspaceFiles,
	moveWorkspaceEntry,
	readWorkspaceFile,
	removeWorkspaceEntry,
	resolveFile,
	workspaceFilePreview,
	writeWorkspaceFile,
	WorkspaceFileError,
} from "../workspace-files.ts";
import { findGitRoot } from "../workspace-review.ts";
import { browseWorkspaceDirectories, searchWorkspaces } from "../workspace-search.ts";
import type { RouteContext } from "./context.ts";
import { endpoints, filePreviewUrl } from "./endpoints.ts";

export const workspaceRoutes = {
	[endpoints.workspaceSearch]: {
		GET: async (request, context) => {
			const query = stringField(await readActionSignals(request), "workspaceDraft");
			const recent = filterWorkspaces(
				[context.store.projectRoot, ...context.store.recentWorkspaces],
				query,
			);
			const search = query.trim()
				? await searchWorkspaces(context.store.workspacePath, query)
				: [];
			return datastarResponse([
				{
					type: "elements",
					elements: renderWorkspaceSearchResults(
						recent,
						search,
						context.store.projectRoot,
					),
				},
				{ type: "effect", effect: { type: "refresh-workspace-picker" } },
			]);
		},
	},
	[endpoints.workspaceBrowse]: {
		GET: async (request, context) => {
			const signals = await readActionSignals(request);
			const value = stringField(signals, "workspacePath");
			const showHidden = booleanField(signals, "showHidden");
			const listing = await browseWorkspaceDirectories(
				context.store.workspacePath,
				value,
				showHidden,
			).catch(() => undefined);
			return datastarResponse([
				{
					type: "signals",
					signals: {
						_workspaceFolderCreating: false,
						_workspaceFolderName: "",
						_workspaceFolderError: "",
					},
				},
				{
					type: "elements",
					elements: listing
						? renderWorkspaceBrowserContent(listing)
						: renderWorkspaceBrowserError(value),
				},
			]);
		},
	},
	[endpoints.workspaceCreateFolder]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const parent = requiredString(signals, "workspacePath");
			const name = stringField(signals, "folderName").trim();
			const showHidden = booleanField(signals, "showHidden");
			if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) {
				return signalsResponse({
					_workspaceFolderError: "Enter a folder name without slashes.",
				});
			}
			try {
				await createWorkspaceEntry(parent, name, "folder");
			} catch (cause) {
				return signalsResponse({
					_workspaceFolderError:
						cause instanceof WorkspaceFileError
							? cause.message
							: "Could not create the folder.",
				});
			}
			const listing = await browseWorkspaceDirectories(
				context.store.workspacePath,
				join(parent, name),
				showHidden,
			);
			return datastarResponse([
				{
					type: "signals",
					signals: {
						_workspaceFolderError: "",
						_workspaceFolderCreating: false,
						_workspaceFolderName: "",
					},
				},
				{ type: "elements", elements: renderWorkspaceBrowserContent(listing) },
			]);
		},
	},
	[endpoints.workspaceFiles]: {
		GET: async (_request, context) => {
			const workspacePath = context.store.workspacePath;
			const includeHiddenDirectories = Boolean(await findGitRoot(workspacePath));
			return Response.json(
				{
					paths: await listWorkspaceFiles(workspacePath, {
						includeHiddenDirectories,
					}),
					workspacePath,
				},
				{ headers: { "cache-control": "no-store" } },
			);
		},
	},
	[endpoints.workspaceFileEntry]: {
		POST: async (request, context) => {
			const value: unknown = await request.json();
			if (
				!isRecord(value) ||
				!isString(value.path) ||
				(value.kind !== "file" && value.kind !== "folder")
			)
				throw new RouteError(400, "Invalid workspace entry.");
			const { kind, path } = value;
			return workspaceFileResponse(() =>
				createWorkspaceEntry(context.store.workspacePath, path, kind),
			);
		},
		PATCH: async (request, context) => {
			const value: unknown = await request.json();
			if (!isRecord(value) || !isString(value.path) || !isString(value.destination))
				throw new RouteError(400, "Invalid workspace entry move.");
			const { destination, path } = value;
			return workspaceFileResponse(() =>
				moveWorkspaceEntry(context.store.workspacePath, path, destination),
			);
		},
		DELETE: async (request, context) => {
			const value: unknown = await request.json();
			if (!isRecord(value) || !isString(value.path)) {
				throw new RouteError(400, "Invalid workspace entry deletion.");
			}
			const { path } = value;
			return workspaceFileResponse(async () => {
				await removeWorkspaceEntry(context.store.workspacePath, path);
				return { path };
			});
		},
	},
	[endpoints.workspaceFileContent]: {
		GET: async (request, context, url) => {
			const params = url.searchParams;
			const filePath = params.get("path") ?? "";
			if (params.get("download") === "1") {
				const { path } = await resolveFile(context.store.workspacePath, filePath);
				const file = Bun.file(path);
				return new Response(file, {
					headers: {
						"content-type": [".ts", ".tsx", ".mts", ".cts"].includes(
							extname(path).toLowerCase(),
						)
							? "text/plain; charset=utf-8"
							: file.type,
						"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`,
						"x-content-type-options": "nosniff",
						"cache-control": "no-store",
					},
				});
			}
			if (params.get("preview") === "1") {
				const { path, size } = await resolveFile(
					context.store.workspacePath,
					filePath,
				);
				const file = Bun.file(path);
				const preview = workspaceFilePreview(file.type);
				if (!preview || preview.kind === "html" || preview.kind === "markdown") {
					throw new RouteError(415, "This file cannot be previewed.");
				}
				return previewFileResponse(
					request,
					file,
					filePath,
					size,
					preview.mimeType,
				);
			}
			return workspaceFileViewResponse(context, filePath);
		},
		PUT: async (request, context) => {
			const value: unknown = await request.json();
			if (
				!isRecord(value) ||
				!isString(value.path) ||
				!isString(value.contents) ||
				!isString(value.revision)
			) {
				throw new RouteError(400, "Invalid workspace file update.");
			}
			const { path, contents, revision } = value;
			const file = await writeWorkspaceFile(
				context.store.workspacePath,
				path,
				contents,
				revision,
			);
			return workspaceFileViewResponse(context, path, file);
		},
	},
	[endpoints.workspaceOpen]: {
		POST: async (request, context) => {
			const path = requiredString(
				await readActionSignals(request),
				"workspacePath",
			);
			if (!(await context.openWorkspace(path))) {
				throw new RouteError(422, "Workspace transition failed.");
			}
			return datastarResponse();
		},
	},
	[endpoints.worktrees]: {
		GET: async (_request, context) => await worktreeDialogResponse(context, true),
	},
	[endpoints.branchSwitch]: {
		POST: (request, context) =>
			worktreeAction(async () => {
				const branch = requiredString(await readActionSignals(request), "branch");
				await switchGitBranch(context.store.workspacePath, branch);
				return closeWorktreeDialog();
			}),
	},
	[endpoints.branchCreate]: {
		POST: (request, context) =>
			worktreeAction(async () => {
				const branch = requiredString(await readActionSignals(request), "branch");
				await createGitBranch(context.store.workspacePath, branch);
				return closeWorktreeDialog();
			}),
	},
	[endpoints.branchDelete]: {
		POST: (request, context) =>
			worktreeAction(async () => {
				const branch = requiredString(await readActionSignals(request), "branch");
				await deleteGitBranch(context.store.workspacePath, branch);
				return await worktreeDialogResponse(context);
			}),
	},
	[endpoints.worktreeRemove]: {
		GET: (request, context) =>
			worktreeAction(async () => {
				const path = requiredString(await readActionSignals(request), "path");
				const { target } = await removableWorktree(context, path);
				return await worktreeRemovalPreview(target.path);
			}, "_worktreeRemoveError"),
		POST: (request, context) =>
			worktreeAction(async () => {
				const signals = await readActionSignals(request);
				const path = requiredString(signals, "path");
				const revision = requiredString(signals, "revision");
				const { projectRoot, target } = await removableWorktree(context, path);
				try {
					await removeGitWorktree(projectRoot, target.path, revision);
				} catch (error) {
					if (!(error instanceof GitWorktreeError)) throw error;
					return await worktreeRemovalPreview(target.path, error.message);
				}
				const worktrees = await inspectGitWorktrees(context.store.workspacePath);
				return datastarResponse([
					{
						type: "elements",
						elements: renderWorktreeDialogContent(worktrees),
					},
					{ type: "effect", effect: { type: "close-worktree-remove-dialog" } },
				]);
			}, "_worktreeRemoveError"),
	},
	[endpoints.worktreeCreate]: {
		POST: (request, context) =>
			worktreeAction(async () => {
				const signals = await readActionSignals(request);
				const branch = requiredString(signals, "branch");
				const base = requiredString(signals, "base");
				const workspacePath = context.store.workspacePath;
				const created = await createGitWorktree(workspacePath, branch, base);
				if (!(await context.openWorkspace(created.sessionPath))) {
					// Roll back the new branch only when opening its checkout failed.
					await removeGitWorktree(created.projectRoot, created.path)
						.then(() => deleteGitBranch(created.projectRoot, created.branch))
						.catch(() => {});
					return signalsResponse({
						_worktreeError: "Could not open the new worktree.",
					});
				}
				return closeWorktreeDialog();
			}),
	},
} satisfies RouteMap<RouteContext>;

async function removableWorktree(context: RouteContext, path: string) {
	const mentioned = await inspectGitWorktrees(context.store.workspacePath);
	const target = mentioned?.worktrees.find((worktree) => worktree.path === path);
	if (!mentioned || !target || target.current || target.path === mentioned.projectRoot)
		throw new GitWorktreeError("This checkout cannot be removed.");
	if (!context.resources.host)
		throw new GitWorktreeError(
			"Session runtime unavailable. Cannot remove the checkout.",
		);
	if (await context.resources.host.hasRunningSessionInWorktree(target.path))
		throw new GitWorktreeError(
			"A session is running in this checkout. Wait for it to finish before removing the checkout.",
		);
	return { projectRoot: mentioned.projectRoot, target };
}

async function worktreeRemovalPreview(path: string, error = ""): Promise<Response> {
	const { paths, revision } = await ignoredWorktreePaths(path);
	return datastarResponse([
		{ type: "elements", elements: renderWorktreeIgnoredPaths(paths) },
		{
			type: "signals",
			signals: {
				_worktreeRemoveReady: true,
				_worktreeRemoveCount: paths.length,
				_worktreeRemoveRevision: revision,
				_worktreeRemoveError: error,
			},
		},
	]);
}

async function worktreeDialogResponse(
	context: RouteContext,
	reset = false,
): Promise<Response> {
	const worktrees = await inspectGitWorktrees(context.store.workspacePath);
	const resetSignals = {
		_worktreeBase:
			worktrees?.branches.find(
				(branch) => branch.ref === `refs/heads/${worktrees.currentBranch}`,
			)?.ref ?? "HEAD",
		_worktreeBranch: "",
		_branchName: "",
		_worktreeCreating: false,
		_worktreeError: "",
		_worktreeTab: "branches",
	};
	return datastarResponse([
		{
			type: "signals",
			signals: reset ? resetSignals : { _worktreeError: "" },
		},
		{ type: "elements", elements: renderWorktreeDialogContent(worktrees) },
	]);
}

function closeWorktreeDialog(): Response {
	return datastarResponse([
		{ type: "effect", effect: { type: "close-worktree-picker" } },
	]);
}

/** Surfaces a git failure as the dialog's inline error; anything else propagates. */
async function worktreeAction(
	run: () => Promise<Response>,
	errorSignal = "_worktreeError",
): Promise<Response> {
	try {
		return await run();
	} catch (error) {
		if (!(error instanceof GitWorktreeError)) throw error;
		return signalsResponse({ [errorSignal]: error.message });
	}
}

async function workspaceFileResponse<Value>(
	operation: () => Promise<Value>,
): Promise<Response> {
	return Response.json(await operation(), {
		headers: { "cache-control": "no-store" },
	});
}

async function workspaceFileViewResponse(
	context: RouteContext,
	filePath: string,
	file?: Awaited<ReturnType<typeof readWorkspaceFile>>,
): Promise<Response> {
	file ??= await readWorkspaceFile(context.store.workspacePath, filePath);
	if (!("preview" in file) || !file.preview)
		return workspaceFileResponse(() => Promise.resolve(file));
	if (file.preview.kind === "markdown") {
		if (!("contents" in file))
			throw new RouteError(415, "This file cannot be previewed.");
		const resolved = await resolveFile(context.store.workspacePath, filePath);
		const html = await renderMarkdownFinal(file.contents, {
			localImageBase: dirname(resolved.path),
		});
		return workspaceFileResponse(() =>
			Promise.resolve({ ...file, preview: { ...file.preview, html } }),
		);
	}
	const url =
		file.preview.kind === "html"
			? filePreviewUrl(
					(await resolveFile(context.store.workspacePath, filePath)).path,
				)
			: `${endpoints.workspaceFileContent}?path=${encodeURIComponent(file.path)}&preview=1`;
	return workspaceFileResponse(() =>
		Promise.resolve({ ...file, preview: { ...file.preview, url } }),
	);
}

function previewFileResponse(
	request: Request,
	file: Blob,
	filePath: string,
	size: number,
	mimeType: string,
): Response {
	const headers = new Headers({
		"accept-ranges": "bytes",
		"cache-control": "no-store",
		"content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(filePath))}`,
		"content-type": mimeType,
		"x-content-type-options": "nosniff",
	});
	if (mimeType === "image/svg+xml") {
		headers.set(
			"content-security-policy",
			"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
		);
	}
	const requested = request.headers.get("range");
	if (!requested) {
		headers.set("content-length", String(size));
		return new Response(file, { headers });
	}
	const range = parseByteRange(requested, size);
	if (!range) {
		headers.set("content-range", `bytes */${size}`);
		return new Response(null, { status: 416, headers });
	}
	const [start, end] = range;
	headers.set("content-length", String(end - start + 1));
	headers.set("content-range", `bytes ${start}-${end}/${size}`);
	return new Response(file.slice(start, end + 1), { status: 206, headers });
}

function parseByteRange(value: string, size: number): [number, number] | undefined {
	const match = /^bytes=(\d*)-(\d*)$/.exec(value);
	if (!match || (!match[1] && !match[2]) || size === 0) return undefined;
	const first = match[1] ? Number(match[1]) : undefined;
	const last = match[2] ? Number(match[2]) : undefined;
	if (
		(first !== undefined && !Number.isSafeInteger(first)) ||
		(last !== undefined && (!Number.isSafeInteger(last) || last < 0))
	)
		return undefined;
	if (first === undefined) {
		if (!last) return undefined;
		return [Math.max(0, size - last), size - 1];
	}
	if (first >= size) return undefined;
	const end = last === undefined ? size - 1 : Math.min(last, size - 1);
	return end < first ? undefined : [first, end];
}

function filterWorkspaces(workspaces: readonly string[], query: string): string[] {
	const normalizedQuery = query.toLowerCase();
	if (!normalizedQuery) return [...workspaces];
	return workspaces.filter((workspacePath) =>
		`${formatHomePath(workspacePath)} ${workspacePath}`
			.toLowerCase()
			.includes(normalizedQuery),
	);
}
