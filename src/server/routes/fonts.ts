import { findFontOption, getActiveFonts, setActiveFonts } from "#src/fonts.ts";
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
			context.renderer.requestCommit();
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
