import {
	enumField,
	optionalString,
	readActionSignals,
	requiredString,
} from "../action-input.ts";
import { datastarResponse, signalsResponse } from "../datastar.ts";
import { RouteError, type RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

export const authRoutes = {
	[endpoints.authOpenLogin]: {
		POST: (_request, context) => {
			requireHost(context).openLogin();
			return datastarResponse();
		},
	},
	[endpoints.authOpenLogout]: {
		POST: (_request, context) => {
			requireHost(context).openLogout();
			return datastarResponse();
		},
	},
	[endpoints.authLoginStart]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const provider = requiredString(signals, "authProvider");
			const type = enumField(signals, "authType", ["oauth", "api_key"] as const);
			if (!requireHost(context).startLogin(provider, type)) {
				throw new RouteError(409, "Login could not be started.");
			}
			return signalsResponse({ authInput: "" });
		},
	},
	[endpoints.authInput]: {
		POST: async (request, context) => {
			const input =
				optionalString(await readActionSignals(request), "authInput") ?? "";
			if (!requireHost(context).submitAuthInput(input)) {
				throw new RouteError(409, "Authentication input was not accepted.");
			}
			return datastarResponse();
		},
	},
	[endpoints.authLogout]: {
		POST: async (request, context) => {
			const provider = requiredString(
				await readActionSignals(request),
				"authProvider",
			);
			if (!requireHost(context).logout(provider)) {
				throw new RouteError(409, "Logout could not be started.");
			}
			return datastarResponse();
		},
	},
	[endpoints.authClose]: {
		POST: (_request, context) => {
			requireHost(context).closeAuth();
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;
