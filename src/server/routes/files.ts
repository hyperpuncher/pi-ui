import { basename } from "@std/path";

import { fileUriToPath } from "../../../static/file-uri.js";
import { pickNativeFilePaths } from "../../native-file-picker.ts";
import { renderFilePickerResults } from "../../ui/pickers.tsx";
import { readActionSignals, requiredString, stringField } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { searchFiles } from "../file-search.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import {
	getTransferredFiles,
	TransferredFileError,
	validateTransferContentLength,
	validateTransferredFiles,
} from "../transferred-files.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerFileRoutes(router: ExactRouter<RouteContext>): void {
	router.register("GET", endpoints.filesSearch, async (request, context) => {
		const signals = await readActionSignals(request);
		const query = stringField(signals, "fileQuery");
		const items = await searchFiles(
			context.store.workspacePath,
			query,
			request.signal,
		);
		return datastarResponse([
			{ type: "elements", elements: renderFilePickerResults(items, query) },
			{ type: "signals", signals: { _filePickerOpen: items.length > 0 } },
		]);
	});
	router.register("POST", endpoints.filesPick, async () =>
		Response.json({ paths: await pickNativeFilePaths() }),
	);
	router.register("POST", endpoints.filesImport, importTransferredFiles);
	router.register("POST", endpoints.filesOpen, openLinkedFile);
}

async function openLinkedFile(
	request: Request,
	context: RouteContext,
): Promise<Response> {
	const uri = requiredString(await readActionSignals(request), "uri");
	const path = fileUriToPath(uri);
	if (!path) throw new RouteError(400, "Invalid file link.");

	let info: Deno.FileInfo;
	try {
		info = await Deno.stat(path);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			throw new RouteError(404, "File not found.");
		}
		throw error;
	}

	if (context.isLocalRequest(request)) {
		await context.openPath(path);
		return new Response(null, { status: 204 });
	}
	if (!info.isFile) {
		throw new RouteError(400, "Only files can be downloaded remotely.");
	}

	const file = await Deno.open(path, { read: true });
	const name = basename(path) || "download";
	return new Response(file.readable, {
		headers: {
			"content-type": "application/octet-stream",
			"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
			"x-content-type-options": "nosniff",
			"x-pi-file-name": encodeURIComponent(name),
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
		return Response.json({
			paths: await context.transferredFiles.importFiles(files),
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
