import type { ImageContent } from "@earendil-works/pi-ai";

import { resizeImage } from "../../image-resize.ts";
import {
	ActionInputError,
	enumField,
	nonnegativeIntegerField,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import {
	TransferredFileError,
	validateTransferContentLength,
	validateTransferredFiles,
} from "../transferred-files.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const promptRoutes = {
	[endpoints.prompt]: {
		POST: async (request, context) => {
			const { prompt, images } = await readPrompt(request);
			context.store.setPromptEditorText("", { broadcast: false });
			const host = requireHost(context);
			if (!(await host.prompt(prompt, { images })))
				throw new RouteError(409, "Prompt was not accepted.");
			return datastarResponse();
		},
	},
	[endpoints.promptFollowUp]: {
		POST: async (request, context) => {
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
		},
	},
	[endpoints.promptDequeue]: {
		POST: (_request, context) => {
			const queued = requireHost(context).restoreQueuedMessages();
			if (!queued) return datastarResponse();
			context.store.setPromptEditorText(queued, { broadcast: false });
			return signalsResponse({ prompt: queued });
		},
	},
	[endpoints.promptQueueRemove]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const streamingBehavior = enumField(signals, "queueBehavior", [
				"steer",
				"followUp",
			] as const);
			const index = nonnegativeIntegerField(signals, "queueIndex");
			if (
				!(await requireHost(context).removeQueuedMessage(
					streamingBehavior,
					index,
				))
			) {
				throw new RouteError(409, "Queued message no longer exists.");
			}
			return datastarResponse();
		},
	},
	[endpoints.abort]: {
		POST: async (_request, context) => {
			await requireHost(context).abort();
			return datastarResponse();
		},
	},
	[endpoints.messagesOlder]: {
		POST: (_request, context) => {
			const messages = context.store.loadOlderMessages();
			if (messages.length > 0) context.renderer.patchOlderMessages(messages);
			return datastarResponse();
		},
	},
	[endpoints.messagesTrim]: {
		POST: (_request, context) => {
			const ids = context.store.trimOldMessages();
			if (ids.length > 0) context.renderer.messagesRemoved(ids.length);
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;

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
	if (
		files.some(
			(file) =>
				/^(?:image\/)?hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name),
		)
	) {
		throw new ActionInputError(
			"HEIC and HEIF images are not supported. Convert them to JPEG or PNG first.",
		);
	}
	const supportedTypes = new Set([
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"image/bmp",
	]);
	if (files.some((file) => !supportedTypes.has(file.type.toLowerCase()))) {
		throw new ActionInputError(
			"Prompt attachments must be JPEG, PNG, GIF, WebP, or BMP images.",
		);
	}
	const images: ImageContent[] = [];
	for (const file of files) {
		const resized = await resizeImage(
			new Uint8Array(await file.arrayBuffer()),
			file.type,
		);
		if (!resized) {
			throw new ActionInputError(
				`Could not process image attachment: ${file.name}`,
			);
		}
		images.push({
			type: "image",
			data: resized.data,
			mimeType: resized.mimeType,
		});
	}
	return {
		prompt: prompt.replace(/\r\n/g, "\n"),
		images: images.length > 0 ? images : undefined,
	};
}
