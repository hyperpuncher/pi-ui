// Opt-in bearer-token gate for `--auth-token`/`PI_UI_AUTH_TOKEN` (server-options.ts). pi-ui
// has no other authentication: binding `--host` to anything but a loopback address (see
// isLoopbackHostname) exposes the whole app — including the workspace file routes, whose
// read path deliberately follows absolute paths and symlinks outside the workspace root
// (see workspace-files.ts) — to every device on that network. This module is the whole
// mechanism: checked once per request in server-main.ts, in front of both the route table
// and the static-asset fallback, before any handler or auth-required route runs.
import { timingSafeEqual } from "node:crypto";

const cookieName = "pi_ui_token";
const cookieMaxAgeSeconds = 60 * 60 * 24 * 30;

function timingSafeEqualStrings(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	// timingSafeEqual throws on a length mismatch; comparing against a same-length,
	// definitely-wrong buffer first keeps the whole check constant-time either way.
	if (left.length !== right.length)
		return timingSafeEqual(left, Buffer.alloc(left.length));
	return timingSafeEqual(left, right);
}

function cookieToken(request: Request): string | undefined {
	const header = request.headers.get("cookie");
	if (!header) return undefined;
	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1) continue;
		if (part.slice(0, separator).trim() !== cookieName) continue;
		try {
			return decodeURIComponent(part.slice(separator + 1).trim());
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function requestToken(request: Request, url: URL): string | undefined {
	const header = request.headers.get("authorization");
	if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
	const queryToken = url.searchParams.get("token");
	if (queryToken) return queryToken;
	return cookieToken(request);
}

export type AuthCheck =
	| { ok: true; setCookie?: string }
	| { ok: false; response: Response };

/**
 * Accepts an `Authorization: Bearer <token>` header, a `?token=` query parameter (so an
 * `EventSource` or a plain browser navigation can authenticate without custom headers), or
 * a previously-set session cookie. A query-parameter match asks the caller to set that
 * cookie on the response, so only the very first request per browser needs the token in
 * the URL.
 */
export function checkAuthToken(request: Request, expectedToken: string): AuthCheck {
	const url = new URL(request.url);
	const provided = requestToken(request, url);
	if (!provided || !timingSafeEqualStrings(provided, expectedToken)) {
		return { ok: false, response: unauthorizedResponse() };
	}
	const fromQuery = url.searchParams.get("token");
	const setCookie = fromQuery
		? `${cookieName}=${encodeURIComponent(expectedToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cookieMaxAgeSeconds}`
		: undefined;
	return { ok: true, setCookie };
}

function unauthorizedResponse(): Response {
	return new Response(
		"Unauthorized. This pi-ui server requires its auth token: open " +
			"http://<host>:<port>/?token=<token> once in this browser, or send an " +
			"Authorization: Bearer <token> header.",
		{
			status: 401,
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"www-authenticate": "Bearer",
			},
		},
	);
}

/** Wraps a Bun.serve fetch/route handler so every response first passes checkAuthToken. */
export function withAuthToken<Handler extends (request: Request) => Promise<Response>>(
	handler: Handler,
	token: string,
): Handler {
	// SAFETY: this closure has the exact `(request: Request) => Promise<Response>` shape
	// `Handler` is constrained to — TypeScript can't infer that an arrow function assigned
	// back to a generic type parameter satisfies it, but the signature matches exactly.
	return (async (request: Request) => {
		const check = checkAuthToken(request, token);
		if (!check.ok) return check.response;
		const response = await handler(request);
		if (check.setCookie) response.headers.append("set-cookie", check.setCookie);
		return response;
	}) as Handler;
}
