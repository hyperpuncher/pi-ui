import { test } from "bun:test";

import { renderAuthDialog } from "#src/ui/auth-dialog.tsx";
import { assertStringIncludes } from "#testing/assertions";

test("OAuth providers distinguish subscriptions from accounts", () => {
	const html = renderAuthDialog({
		mode: "login",
		phase: "providers",
		providers: [
			{
				id: "openai",
				name: "OpenAI",
				authType: "oauth",
				subscription: true,
			},
			{
				id: "radius",
				name: "Radius",
				authType: "oauth",
				subscription: false,
			},
		],
		progress: [],
	});

	assertStringIncludes(html, ">Subscription</span>");
	assertStringIncludes(html, ">Account</span>");
});
