import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import type { AppAuthDialog } from "../state/app-store.ts";
import { renderAuthDialogContent } from "./auth-dialog.tsx";

Deno.test("authentication prompts keep actions in the dialog footer", () => {
	const dialog: AppAuthDialog = {
		mode: "login",
		phase: "api-key",
		providers: [],
		providerId: "openrouter",
		providerName: "OpenRouter",
		prompt: {
			message: "Enter OpenRouter API key",
			secret: true,
		},
		progress: [],
	};
	const html = renderAuthDialogContent(dialog);

	assertEquals(html.includes("Starting authentication"), false);
	assertStringIncludes(html, 'type="password"');
	assertStringIncludes(html, "Enter OpenRouter API key");
	assert(html.indexOf("Continue") > html.indexOf("<footer>"));
});
