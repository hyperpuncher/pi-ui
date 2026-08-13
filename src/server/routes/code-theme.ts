import { preloadHighlighter } from "@pierre/diffs";

import { findCodeTheme } from "../../code-themes.ts";
import { getPierreThemes, setActiveCodeTheme } from "../../pierre-theme.ts";
import { writeCodeThemePreference } from "../code-theme-preferences.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerCodeThemeRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.codeTheme, async (request, context) => {
		let value: unknown;
		try {
			value = await request.json();
		} catch {
			throw new RouteError(400, "Malformed code theme preference.");
		}
		const record =
			typeof value === "object" && value !== null
				? (value as Record<string, unknown>)
				: undefined;
		const appearance = record?.appearance;
		if (appearance !== "light" && appearance !== "dark") {
			throw new RouteError(400, "Unknown code theme appearance.");
		}
		const theme = findCodeTheme(appearance, record?.name);
		if (!theme) throw new RouteError(400, "Unknown code theme.");

		await preloadHighlighter({ langs: [], themes: [theme.name] });
		const themes = { ...getPierreThemes(), [appearance]: theme.name };
		await writeCodeThemePreference(themes);
		setActiveCodeTheme(themes);
		context.renderer.codeThemeChanged();
		return Response.json(themes);
	});
}
