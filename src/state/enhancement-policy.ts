export type EnhancementWorkKind = "markdown" | "code" | "diff";

// Oversized final highlighting is presentation-only. Keep the safe fallback until
// the user explicitly requests enhancement instead of monopolizing an interactive task.
const maximumAutomaticMarkdownBytes = 16 * 1024;
const maximumAutomaticToolBytes = 32 * 1024;

export function shouldDeferEnhancement(kind: EnhancementWorkKind, text: string): boolean {
	const bytes = new TextEncoder().encode(text).byteLength;
	return (
		bytes >
		(kind === "markdown" ? maximumAutomaticMarkdownBytes : maximumAutomaticToolBytes)
	);
}
