import { isAbsolute, relative } from "node:path";

import { detectSupportedImageMimeTypeFromFile } from "@earendil-works/pi-coding-agent";

import { fileUriToPath, isHtmlFileUri } from "../../../static/file-uri.js";
import { renderFilePickerResults } from "../../ui/pickers.tsx";
import { readActionSignals, requiredString, stringField } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { searchFiles } from "../file-search.ts";
import { RouteError, type RouteMap } from "../route.ts";
import {
	getTransferredFiles,
	TransferredFileError,
	validateTransferContentLength,
	validateTransferredFiles,
} from "../transferred-files.ts";
import { resolveFile } from "../workspace-files.ts";
import type { RouteContext } from "./context.ts";
import { endpoints, filesPreviewBase } from "./endpoints.ts";

export const fileRoutes = {
	[endpoints.filesSearch]: {
		GET: async (request, context) => {
			const signals = await readActionSignals(request);
			const query = stringField(signals, "fileQuery");
			const items = await searchFiles(
				context.store.workspacePath,
				query,
				request.signal,
				context.resources.fdPath,
			);
			return datastarResponse([
				{ type: "elements", elements: renderFilePickerResults(items, query) },
				{ type: "signals", signals: { _filePickerOpen: items.length > 0 } },
			]);
		},
	},
	[endpoints.filesImport]: {
		POST: importTransferredFiles,
	},
	[endpoints.filesOpen]: {
		GET: openLinkedFile,
		POST: openLinkedFile,
	},
	[endpoints.filesPreview]: {
		GET: previewFile,
	},
} satisfies RouteMap<RouteContext>;

async function openLinkedFile(
	request: Request,
	context: RouteContext,
): Promise<Response> {
	const uri =
		request.method === "GET"
			? (new URL(request.url).searchParams.get("uri") ?? "")
			: requiredString(await readActionSignals(request), "uri");
	const path = fileUriToPath(uri);
	if (!path) throw new RouteError(400, "Invalid file link.");

	const workspacePath = context.store.workspacePath;
	const relativePath = relative(workspacePath, path).replaceAll("\\", "/");
	const filePath =
		relativePath === ".." ||
		relativePath.startsWith("../") ||
		isAbsolute(relativePath)
			? path
			: relativePath;
	await resolveFile(workspacePath, filePath);
	if (request.method === "GET") {
		if (!isHtmlFileUri(uri))
			throw new RouteError(400, "Only HTML files can be previewed.");
		const source = new URL(uri);
		const previewPath =
			filesPreviewBase +
			path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
		return new Response(null, {
			status: 302,
			headers: {
				location: previewPath + source.search + source.hash,
				"cache-control": "no-store",
			},
		});
	}
	return Response.json({ path: filePath, workspacePath });
}

async function previewFile(request: Request, context: RouteContext): Promise<Response> {
	const url = new URL(request.url);
	let filePath: string;
	try {
		filePath = decodeURIComponent(url.pathname.slice(filesPreviewBase.length));
	} catch {
		throw new RouteError(400, "Invalid file path.");
	}
	const { path } = await resolveFile(context.store.workspacePath, filePath);
	const assets = `${url.origin}${filesPreviewBase}`;
	return new Response(Bun.file(path), {
		headers: {
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
			// Keep generated pages in an opaque origin. Allow local presentation
			// and inline scripts, but no API requests, forms, frames or popups.
			"content-security-policy": [
				"sandbox allow-scripts",
				"default-src 'none'",
				`script-src 'unsafe-inline' ${assets}`,
				`style-src 'unsafe-inline' ${assets}`,
				`img-src data: ${assets}`,
				`font-src data: ${assets}`,
				`media-src data: ${assets}`,
				"connect-src 'none'",
				"base-uri 'none'",
				"form-action 'none'",
				"frame-ancestors 'none'",
			].join("; "),
		},
	});
}

async function importTransferredFiles(
	request: Request,
	context: RouteContext,
): Promise<Response> {
	const contentLengthError = validateTransferContentLength(
		request.headers.get("content-length"),
	);
	if (contentLengthError) return transferredFileErrorResponse(contentLengthError);

	const formData = await request.formData();
	const files = getTransferredFiles(formData);
	const validationError = validateTransferredFiles(files);
	if (validationError) return transferredFileErrorResponse(validationError);

	try {
		const paths = await context.transferredFiles.importFiles(files);
		return Response.json({
			imports: await Promise.all(
				paths.map(async (path) => ({
					path,
					mimeType: await detectSupportedImageMimeTypeFromFile(path),
				})),
			),
		});
	} catch (error) {
		if (error instanceof TransferredFileError) {
			return transferredFileErrorResponse(error);
		}
		throw error;
	}
}

function transferredFileErrorResponse(error: {
	code: string;
	message: string;
	status: number;
}): Response {
	return Response.json(
		{ error: error.code, message: error.message },
		{ status: error.status },
	);
}
