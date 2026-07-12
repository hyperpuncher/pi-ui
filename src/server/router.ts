import { ActionInputError } from "./action-input.ts";
import { errorResponse } from "./datastar.ts";

export type RouteHandler<Context> = (
	request: Request,
	context: Context,
	url: URL,
) => Response | Promise<Response>;

export type RouteErrorReporter = (
	error: unknown,
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

export class ExactRouter<Context> {
	readonly #routes = new Map<string, RouteHandler<Context>>();
	readonly #paths = new Set<string>();

	constructor(
		private readonly context: Context,
		private readonly reportError: RouteErrorReporter = defaultErrorReporter,
	) {}

	register(method: string, pathname: string, handler: RouteHandler<Context>): this {
		const normalizedMethod = method.toUpperCase();
		const key = routeKey(normalizedMethod, pathname);
		if (this.#routes.has(key)) throw new Error(`Duplicate route: ${key}`);
		this.#routes.set(key, handler);
		this.#paths.add(pathname);
		return this;
	}

	has(method: string, pathname: string): boolean {
		return this.#routes.has(routeKey(method.toUpperCase(), pathname));
	}

	registeredRoutes(): readonly string[] {
		return [...this.#routes.keys()];
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const handler = this.#routes.get(routeKey(request.method, url.pathname));
		if (!handler) {
			return errorResponse(
				this.#paths.has(url.pathname) ? 405 : 404,
				this.#paths.has(url.pathname) ? "Method not allowed." : "Not found.",
			);
		}
		try {
			return await handler(request, this.context, url);
		} catch (error) {
			if (error instanceof ActionInputError || error instanceof RouteError) {
				return errorResponse(error.status, error.message);
			}
			this.reportError(error, request);
			return errorResponse(500, "An internal error occurred.");
		}
	}
}

function routeKey(method: string, pathname: string): string {
	return `${method} ${pathname}`;
}

function defaultErrorReporter(
	error: unknown,
	request: Pick<Request, "method" | "url">,
): void {
	const url = new URL(request.url);
	const details =
		error instanceof Error
			? { name: error.name, stack: error.stack?.split("\n").slice(1).join("\n") }
			: { type: typeof error };
	console.error(`Route ${request.method} ${url.pathname} failed`, details);
}
