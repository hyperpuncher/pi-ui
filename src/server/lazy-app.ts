import { errorResponse } from "./datastar.ts";
import { executeRoute, type RouteHandler } from "./route.ts";
import { appRoutes } from "./routes.ts";
import type { RouteContext } from "./routes/context.ts";

let appPromise: ReturnType<typeof loadApp> | undefined;

export const routes = Object.fromEntries(
	Object.entries(appRoutes).map(([pathname, handlers]) => [
		pathname,
		Object.fromEntries(
			Object.entries(handlers).map(([method, handler]) => [
				method,
				bindRoute(handler),
			]),
		),
	]),
);

export async function fallback(request: Request): Promise<Response> {
	const loaded = await getApp();
	const response =
		request.method === "GET"
			? await loaded.app.context.serveStatic(request)
			: errorResponse(404, "Not found.");
	return loaded.compressResponse(request, response);
}

export async function disposeApp(): Promise<void> {
	const loaded = await appPromise?.catch(() => undefined);
	await loaded?.app.dispose();
}

function bindRoute(handler: RouteHandler<RouteContext>) {
	return async (request: Request): Promise<Response> => {
		const loaded = await getApp();
		return loaded.compressResponse(
			request,
			await executeRoute(request, loaded.app.context, handler),
		);
	};
}

function getApp(): ReturnType<typeof loadApp> {
	return (appPromise ??= loadApp());
}

async function loadApp() {
	const [{ registerBunOAuthFlows }, { createApp }, { compressResponse }] =
		await Promise.all([
			import("@earendil-works/pi-ai/bun-oauth"),
			import("./app.ts"),
			import("./compression.ts"),
		]);
	registerBunOAuthFlows();
	return { app: await createApp(), compressResponse };
}
