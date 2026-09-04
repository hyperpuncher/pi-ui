import { preloadHighlighter } from "@pierre/diffs";

import { findCodeTheme } from "../../code-themes.ts";
import { getPierreThemes, setActiveCodeTheme } from "../../pierre-theme.ts";
import { enumField, readActionSignals, requiredString } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const codeThemeRoutes = {
	[endpoints.codeTheme]: {
		POST: async (request, context) => {
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
			await updateAppConfig((config) => {
				config.codeTheme = themes;
			});
			setActiveCodeTheme(themes);
			context.renderer.codeThemeChanged();
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
