import { isRecord, isString } from "../utils/type-guards.ts";

export function providerErrorPresentation(raw: string) {
	const text = raw.trim();
	const prefix =
		text.match(/^(?:Error(?::\s*|\s+))?(?:\d{3}(?::\s*|\s+))?/u)?.[0] ?? "";
	const body = text.slice(prefix.length);
	let summary = "view details";
	let details = raw;
	try {
		const value: unknown = JSON.parse(body);
		if (isRecord(value)) {
			const message = [
				isRecord(value.error) ? value.error.message : undefined,
				value.message,
				value.detail,
			].find(
				(value): value is string => isString(value) && value.trim().length > 0,
			);
			summary = message?.trim().split("\n")[0] ?? summary;
		}
		details = `${prefix}${JSON.stringify(value, null, "\t")}`;
	} catch {
		if (body && !body.startsWith("{") && !body.startsWith("[")) {
			summary = body.trim().split("\n")[0];
		}
	}
	return {
		summary: summary.length > 160 ? `${summary.slice(0, 159)}…` : summary,
		details,
	};
}

const structuredProviderErrorPattern = /^(\d{3}):\s*(\{[\s\S]*\})$/u;

export function formatProviderErrorMessage(errorMessage?: string): string {
	const raw = errorMessage?.trim() || "Unknown error";
	const match = raw.match(structuredProviderErrorPattern);
	if (!match) return `Error: ${raw}`;

	try {
		const body: unknown = JSON.parse(match[2]);
		return `Error ${match[1]}: ${JSON.stringify(body, null, "\t")}`;
	} catch {
		return `Error: ${raw}`;
	}
}
