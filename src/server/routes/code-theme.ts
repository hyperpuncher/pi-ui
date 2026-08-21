import { preloadHighlighter } from "@pierre/diffs";

import { findCodeTheme } from "../../code-themes.ts";
import { getPierreThemes, setActiveCodeTheme } from "../../pierre-theme.ts";
import { enumField, readActionSignals, requiredString } from "../action-input.ts";
import { writeCodeThemePreference } from "../code-theme-preferences.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerCodeThemeRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.codeTheme, async (request, context) => {
		const signals = await readActionSignals(request);
		const appearance = enumField(signals, "codeThemeAppearance", [
			"light",
			"dark",
		] as const);
		const name = requiredString(signals, "codeThemeName");
		const theme = findCodeTheme(appearance, name);
		if (!theme) throw new RouteError(400, "Unknown code theme.");

		await preloadHighlighter({ langs: [], themes: [theme.name] });
		const themes = { ...getPierreThemes(), [appearance]: theme.name };
		await writeCodeThemePreference(themes);
		setActiveCodeTheme(themes);
		context.renderer.codeThemeChanged();
		return datastarResponse([
			{
				type: "signals",
				signals: {
					_codeThemeLight: themes.light,
					_codeThemeDark: themes.dark,
					_codeThemeAppliedAppearance: appearance,
					_codeThemeAppliedName: theme.name,
				},
			},
		]);
	});
}
