import {
	enumField,
	optionalString,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type ExactRouter } from "../router.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export function registerAuthRoutes(router: ExactRouter<RouteContext>): void {
	router.register("POST", endpoints.authOpenLogin, (_request, context) => {
		requireHost(context).openLogin();
		return datastarResponse();
	});
	router.register("POST", endpoints.authOpenLogout, (_request, context) => {
		requireHost(context).openLogout();
		return datastarResponse();
	});
	router.register("POST", endpoints.authLoginStart, async (request, context) => {
		const signals = await readActionSignals(request);
		const provider = requiredString(signals, "authProvider");
		const type = enumField(signals, "authType", ["oauth", "api_key"] as const);
		if (!requireHost(context).startLogin(provider, type)) {
			throw new RouteError(409, "Login could not be started.");
		}
		return signalsResponse({ authInput: "" });
	});
	router.register("POST", endpoints.authInput, async (request, context) => {
		const input = optionalString(await readActionSignals(request), "authInput") ?? "";
		if (!requireHost(context).submitAuthInput(input)) {
			throw new RouteError(409, "Authentication input was not accepted.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.authLogout, async (request, context) => {
		const provider = requiredString(await readActionSignals(request), "authProvider");
		if (!requireHost(context).logout(provider)) {
			throw new RouteError(409, "Logout could not be started.");
		}
		return datastarResponse();
	});
	router.register("POST", endpoints.authClose, (_request, context) => {
		requireHost(context).closeAuth();
		return datastarResponse();
	});
}
