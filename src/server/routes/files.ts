import { pickNativeFilePaths } from "../../native-file-picker.ts";
import { renderFilePickerResults } from "../../ui/pickers.tsx";
import { readActionSignals, stringField } from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { searchFiles } from "../file-search.ts";
import type { ExactRouter } from "../router.ts";
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
			{ type: "elements", elements: renderFilePickerResults(items) },
		]);
	});
	router.register("POST", endpoints.filesPick, async () =>
		Response.json({ paths: await pickNativeFilePaths() }),
	);
	router.register("POST", endpoints.filesImport, importTransferredFiles);
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
