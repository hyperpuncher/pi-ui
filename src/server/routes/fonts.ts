import { findFontOption, getActiveFonts, setActiveFonts } from "../../fonts.ts";
import { enumField, readActionSignals, requiredString } from "../action-input.ts";
import { updateAppConfig } from "../app-config.ts";
import { datastarResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerFontRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.fonts, async (request, context) => {
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
	});
}
