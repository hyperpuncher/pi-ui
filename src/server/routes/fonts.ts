import { findFontOption, getActiveFonts, setActiveFonts } from "../../fonts.ts";
import { enumField, readActionSignals, requiredString } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const fontRoutes = {
	[endpoints.fonts]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const kind = enumField(signals, "fontKind", ["sans", "mono"] as const);
			const name = requiredString(signals, "fontName");
			if (!findFontOption(kind, name)) throw new RouteError(400, "Unknown font.");

			const fonts = { ...getActiveFonts(), [kind]: name };
			await updateAppConfig((config) => {
				config.fonts = fonts;
			});
			setActiveFonts(fonts);
			context.renderer.fontsChanged();
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
