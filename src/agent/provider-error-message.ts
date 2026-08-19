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
