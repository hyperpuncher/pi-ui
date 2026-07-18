import { readActionSignals, requiredString } from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";
import { treeOpenEvents } from "./tree.ts";

export function registerPromptRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.prompt, async (request, context) => {
		const signals = await readActionSignals(request);
		const prompt = requiredString(signals, "prompt");
		const host = requireHost(context);
		if (prompt.trim() === "/tree") {
			host.openTree();
			return datastarResponse(treeOpenEvents(context));
		}
		if (!(await host.prompt(prompt)))
			throw new RouteError(409, "Prompt was not accepted.");
		return datastarResponse();
	});

	router.register("POST", endpoints.promptFollowUp, async (request, context) => {
		const prompt = requiredString(await readActionSignals(request), "prompt");
		if (
			!(await requireHost(context).prompt(prompt, {
				streamingBehavior: "followUp",
			}))
		) {
			throw new RouteError(409, "Prompt was not accepted.");
		}
		return datastarResponse();
	});

	router.register("POST", endpoints.promptDequeue, (_request, context) => {
		const queued = requireHost(context).restoreQueuedMessages();
		return queued ? signalsResponse({ prompt: queued }) : datastarResponse();
	});

	router.register("POST", endpoints.abort, async (_request, context) => {
		await requireHost(context).abort();
		return datastarResponse();
	});

	router.register("POST", endpoints.messagesOlder, (_request, context) => {
		if (!context.store.loadOlderMessages({ broadcast: false })) {
			return datastarResponse();
		}
		return datastarResponse([
			{ type: "elements", elements: context.renderer.renderMessagesElement() },
			{ type: "effect", effect: { type: "restore-messages-anchor" } },
		]);
	});

	router.register("POST", endpoints.messagesEnhance, (_request, context, url) => {
		if (!context.renderer.enhanceMessage(url.searchParams.get("id") ?? "")) {
			throw new RouteError(409, "Message is not deferred.");
		}
		return datastarResponse();
	});
}
