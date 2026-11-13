import { stripAnsi } from "#pi/utils/ansi.js";
import { isRecord, isString } from "#src/utils/type-guards.ts";

export { stripAnsi };

/** Renders message content as plain text; image parts become placeholders. */
export function contentToText<Content>(
	content: Content,
	includeImagePlaceholders = true,
): string {
	if (isString(content)) {
		return stripAnsi(content);
	}
	if (!Array.isArray(content)) {
		return summarizeValue(content);
	}
	return content
		.map((part) => {
			if (isRecord(part) && part.type === "text" && isString(part.text)) {
				return stripAnsi(part.text);
			}
			if (isRecord(part) && part.type === "image") {
				return includeImagePlaceholders
					? `[image: ${String(part.mimeType ?? "unknown")}]`
					: "";
			}
			if (isRecord(part) && part.type === "thinking") {
				return "";
			}
			if (isRecord(part) && part.type === "toolCall") {
				return "";
			}
			return summarizeValue(part);
		})
		.filter(Boolean)
		.join("\n");
}

/** Text of the `text` blocks in message content, joined by `separator`. */
export function textContent<Content>(content: Content, separator = " "): string {
	if (isString(content)) return content;
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((part) =>
			isRecord(part) && part.type === "text" && isString(part.text)
				? [part.text]
				: [],
		)
		.join(separator);
}

export function summarizeValue<Value>(value: Value): string {
	if (isString(value)) {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}
