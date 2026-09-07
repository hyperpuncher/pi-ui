import type { Models } from "@earendil-works/pi-ai";

/** OpenCode requires client identity and stable session routing for coding agents. */
export function configureOpenCodeHeaders(models: Models, sessionId: string): void {
	const streamSimple = models.streamSimple.bind(models);
	models.streamSimple = (model, context, options) => {
		if (model.provider !== "opencode-go" && model.provider !== "opencode")
			return streamSimple(model, context, options);
		return streamSimple(model, context, {
			...options,
			headers: {
				...options?.headers,
				"User-Agent": "pi-ui",
				"x-opencode-session": `pi-ui:${options?.sessionId ?? sessionId}`,
			},
		});
	};
}
