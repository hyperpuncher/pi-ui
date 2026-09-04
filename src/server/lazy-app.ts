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

export async function fallback(
	request: Request,
	server: Bun.Server<undefined>,
): Promise<Response> {
	const loaded = await getApp();
	markLocal(request, server, loaded.app.localRequests);
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

export function isLoopbackAddress(address: Readonly<{ address: string }>): boolean {
	const hostname = address.address.toLowerCase();
	return (
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname === "0:0:0:0:0:0:0:1" ||
		/^127(?:\.\d{1,3}){3}$/.test(hostname) ||
		hostname.startsWith("::ffff:127.")
	);
}

function bindRoute(handler: RouteHandler<RouteContext>) {
	return (request: Request, server: Bun.Server<undefined>) =>
		dispatch(request, server, handler);
}

async function dispatch(
	request: Request,
	server: Bun.Server<undefined>,
	handler: RouteHandler<RouteContext>,
): Promise<Response> {
	const loaded = await getApp();
	markLocal(request, server, loaded.app.localRequests);
	return loaded.compressResponse(
		request,
		await executeRoute(request, loaded.app.context, handler),
	);
}

function markLocal(
	request: Request,
	server: Bun.Server<undefined>,
	localRequests: WeakSet<Request>,
): void {
	const peer = server.requestIP(request);
	if (peer && isLoopbackAddress(peer)) localRequests.add(request);
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
