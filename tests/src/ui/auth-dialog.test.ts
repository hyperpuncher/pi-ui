import { expect, test } from "bun:test";

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

test("device login offers copying only when the provider permits it", () => {
	for (const openBrowserOnConfirm of [false, true]) {
		for (const copyCodeOnConfirm of [false, true]) {
			const html = renderAuthDialog({
				mode: "login",
				phase: "oauth",
				providers: [],
				progress: [],
				url: "https://example.com/device",
				deviceCode: "ABCD-1234",
				openBrowserOnConfirm,
				copyCodeOnConfirm,
			});
			expect(html.includes("window.piUi.copyText(")).toBe(copyCodeOnConfirm);
			expect(html.includes("Copy code and open browser")).toBe(
				openBrowserOnConfirm && copyCodeOnConfirm,
			);
			expect(html).toContain("ABCD-1234");
		}
	}
});
