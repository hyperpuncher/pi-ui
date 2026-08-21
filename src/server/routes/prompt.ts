import type { ImageContent } from "@earendil-works/pi-ai";

import {
	ActionInputError,
	enumField,
	nonnegativeIntegerField,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import {
	TransferredFileError,
	validateTransferContentLength,
	validateTransferredFiles,
} from "../transferred-files.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";
import { treeOpenEvents } from "./tree.ts";

export function registerPromptRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.prompt, async (request, context) => {
		const { prompt, images } = await readPrompt(request);
		context.store.setPromptEditorText("", { broadcast: false });
		const host = requireHost(context);
		if (prompt.trim() === "/tree") {
			host.openTree();
			return datastarResponse(treeOpenEvents());
		}
		if (!(await host.prompt(prompt, { images })))
			throw new RouteError(409, "Prompt was not accepted.");
		return datastarResponse();
	});

	router.register("POST", endpoints.promptFollowUp, async (request, context) => {
		const { prompt, images } = await readPrompt(request);
		context.store.setPromptEditorText("", { broadcast: false });
		if (
			!(await requireHost(context).prompt(prompt, {
				images,
				streamingBehavior: "followUp",
			}))
		) {
			throw new RouteError(409, "Prompt was not accepted.");
		}
		return datastarResponse();
	});

	router.register("POST", endpoints.promptDequeue, (_request, context) => {
		const queued = requireHost(context).restoreQueuedMessages();
		if (!queued) return datastarResponse();
		context.store.setPromptEditorText(queued, { broadcast: false });
		return signalsResponse({ prompt: queued });
	});

	router.register("POST", endpoints.promptQueueRemove, async (request, context) => {
		const signals = await readActionSignals(request);
		const streamingBehavior = enumField(signals, "queueBehavior", [
			"steer",
			"followUp",
		] as const);
		const index = nonnegativeIntegerField(signals, "queueIndex");
		if (!(await requireHost(context).removeQueuedMessage(streamingBehavior, index))) {
			throw new RouteError(409, "Queued message no longer exists.");
		}
		return datastarResponse();
	});

	router.register("POST", endpoints.abort, async (_request, context) => {
		await requireHost(context).abort();
		return datastarResponse();
	});

	router.register("POST", endpoints.messagesOlder, (_request, context) => {
		const ids = context.store.loadOlderMessages();
		if (ids.length > 0) context.renderer.patchOlderMessages(ids);
		return datastarResponse();
	});

	router.register("POST", endpoints.messagesEnhance, (_request, context, url) => {
		if (!context.renderer.enhanceMessage(url.searchParams.get("id") ?? "")) {
			throw new RouteError(409, "Message is not deferred.");
		}
		return datastarResponse();
	});
}

async function readPrompt(
	request: Request,
): Promise<{ prompt: string; images?: ImageContent[] }> {
	if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) {
		return { prompt: requiredString(await readActionSignals(request), "prompt") };
	}
	const contentLengthError = validateTransferContentLength(
		request.headers.get("content-length"),
	);
	if (contentLengthError) throw new TransferredFileError(contentLengthError);
	const formData = await request.formData();
	const prompt = formData.get("prompt");
	if (prompt === null || prompt instanceof File || prompt.trim() === "") {
		throw new ActionInputError("Missing or invalid prompt.");
	}
	const files = formData
		.getAll("image")
		.filter((value): value is File => value instanceof File);
	const validationError = validateTransferredFiles(files);
	if (validationError) throw new TransferredFileError(validationError);
	if (files.some((file) => !file.type.startsWith("image/"))) {
		throw new ActionInputError("Prompt attachments must be images.");
	}
	const images = await Promise.all(
		files.map(async (file): Promise<ImageContent> => ({
			type: "image",
			data: new Uint8Array(await file.arrayBuffer()).toBase64(),
			mimeType: file.type,
		})),
	);
	return {
		prompt: prompt.replace(/\r\n/g, "\n"),
		images: images.length > 0 ? images : undefined,
	};
}
