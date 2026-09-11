import { isRecord, isString } from "./type-guards.ts";

export function errorMessage(error: ErrorOptions["cause"]): string {
	return error instanceof Error ? error.message : String(error);
}

/** Reads an error string from a failed JSON response, else the fallback. */
export async function responseErrorMessage(
	response: Response,
	fallback: string,
): Promise<string> {
	try {
		const body: unknown = await response.json();
		if (isRecord(body)) {
			if (isString(body.error)) return body.error;
			if (isString(body.message)) return body.message;
		}
	} catch {
		// Fall through to the fallback when the body is not JSON.
	}
	return fallback;
}
