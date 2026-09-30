import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

import {
	createLlamaProvider,
	LLAMA_PROVIDER_ID,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/llama/provider.js";

export const llamaProviderExtension: InlineExtension = {
	name: LLAMA_PROVIDER_ID,
	builtin: true,
	factory: (api: ExtensionAPI) => {
		api.registerProvider(createLlamaProvider().provider);
	},
	hidden: true,
};
