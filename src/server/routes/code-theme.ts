import { preloadHighlighter } from "@pierre/diffs";

import { findCodeTheme } from "#src/code-themes.ts";
import { getPierreThemes, setActiveCodeTheme } from "#src/pierre-theme.ts";
import {
	enumField,
	readActionSignals,
	requiredString,
} from "#src/server/action-input.ts";
import { updateAppConfig } from "#src/server/app-config.ts";
import { datastarResponse } from "#src/server/datastar.ts";
import { RouteError, type RouteMap } from "#src/server/route.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";

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

			await preloadHighlighter({
				langs: [],
				themes: [theme.name],
				preferredHighlighter: "shiki-wasm",
			});
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
