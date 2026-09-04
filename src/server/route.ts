import { ActionInputError } from "./action-input.ts";
import { errorResponse } from "./datastar.ts";

export type RouteHandler<Context> = (
	request: Request,
	context: Context,
	url: URL,
) => Response | Promise<Response>;

export type RouteMap<Context> = Record<
	string,
	Partial<Record<Bun.Serve.HTTPMethod, RouteHandler<Context>>>
>;

type RouteErrorReporter = (
	error: ErrorOptions["cause"],
	request: Pick<Request, "method" | "url">,
) => void;

export class RouteError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "RouteError";
	}
}

export async function executeRoute<Context>(
	request: Request,
	context: Context,
	handler: RouteHandler<Context>,
	reportError: RouteErrorReporter = defaultErrorReporter,
): Promise<Response> {
	try {
		return await handler(request, context, new URL(request.url));
	} catch (error) {
		if (request.signal.aborted) return new Response(null, { status: 499 });
		if (error instanceof ActionInputError || error instanceof RouteError) {
			return errorResponse(error.status, error.message);
		}
		reportError(error, request);
		return errorResponse(500, "An internal error occurred.");
	}
}

function defaultErrorReporter(
	error: ErrorOptions["cause"],
	request: Pick<Request, "method" | "url">,
): void {
	const url = new URL(request.url);
	const details =
		error instanceof Error
			? { name: error.name, stack: error.stack?.split("\n").slice(1).join("\n") }
			: { type: Object.prototype.toString.call(error) };
	console.error(`Route ${request.method} ${url.pathname} failed`, details);
}
