import type { AppMessageTitlePart } from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";

const bashPreviewLines = 4;
const bashCompactThreshold = 7;
const hiddenBashOutputCommands = new Set(["fd", "find", "grep", "ls", "rg", "tree"]);

export function toolTitleParts(toolName: string, args: unknown): AppMessageTitlePart[] {
	const record = asRecord(args);
	if (toolName === "bash" && record) {
		const timeout =
			typeof record.timeout === "number" ? ` timeout ${record.timeout}s` : "";
		return [
			{ text: "$ ", tone: "accent", mono: true },
			{
				text: formatShellCommandDisplay(stringValue(record.command)) || "...",
				mono: true,
				highlight: "bash",
			},
			...(timeout ? [{ text: timeout, tone: "muted", mono: true } as const] : []),
		];
	}

	const target = toolTarget(toolName, args);
	return [
		{ text: toolName },
		...(target ? [{ text: target, tone: "accent", mono: true } as const] : []),
		...(toolRange(args)
			? [{ text: toolRange(args), tone: "warning", mono: true } as const]
			: []),
	];
}

export function formatShellCommandDisplay(command: string): string {
	if (command.length <= 90) return command;

	let result = "";
	let quote: "'" | '"' | "`" | undefined;
	let escaped = false;
	let comment = false;
	let blockDepth = 0;
	const continuation = () => `\n${"  ".repeat(blockDepth)}`;

	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (comment) {
			result += char;
			if (char === "\n") comment = false;
			continue;
		}
		if (escaped) {
			result += char;
			escaped = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			result += char;
			escaped = true;
			continue;
		}
		if (quote) {
			result += char;
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			quote = char;
			result += char;
			continue;
		}
		if (char === "#" && (index === 0 || /[\s;|&{(]/.test(command[index - 1]))) {
			comment = true;
			result += char;
			continue;
		}

		const operator = [";;&", "&&", "||", "|&", ";;", ";&", "|", ";"].find(
			(candidate) => command.startsWith(candidate, index),
		);
		if (operator) {
			const separator = ["&&", "||", "|", "|&"].includes(operator)
				? ` ${operator}`
				: operator;
			result = `${result.trimEnd()}${separator}${continuation()}`;
			index += operator.length - 1;
			while (command[index + 1] === " ") index++;
			continue;
		}
		if (char === "{" && command[index - 1] !== "$") {
			result += `{`;
			blockDepth++;
			result += continuation();
			while (command[index + 1] === " ") index++;
			continue;
		}
		if (char === "}" && blockDepth > 0) {
			blockDepth--;
			result = `${result.trimEnd()}${continuation()}}`;
			while (command[index + 1] === " ") index++;
			continue;
		}
		result += char;
	}

	return result.trimEnd();
}

export function toolTitle(
	status: "running" | "success" | "error",
	toolName: string,
	args: unknown,
): string {
	const record = asRecord(args);
	if (toolName === "bash" && record) {
		const timeout =
			typeof record.timeout === "number" ? ` timeout ${record.timeout}s` : "";
		return `$ ${stringValue(record.command) || "..."}${timeout}`;
	}

	const verb = toolName;
	const target = toolTarget(toolName, args);
	return target ? `${verb} ${target}${toolRange(args)}` : verb;
}

export function toolMeta(toolName: string, args: unknown): string | undefined {
	const record = asRecord(args);
	if (!record) return undefined;
	const details: string[] = [];
	if (toolName === "edit" && Array.isArray(record.edits)) {
		details.push(
			`${record.edits.length} edit${record.edits.length === 1 ? "" : "s"}`,
		);
	}
	if (typeof record.limit === "number") {
		details.push(`limit ${record.limit}`);
	}
	return details.join(" • ") || undefined;
}

export function toolEndMeta(startedAt: number | undefined): string | undefined {
	if (startedAt === undefined) return undefined;
	const duration = formatDuration(Date.now() - startedAt);
	return duration === "0.0s" ? undefined : duration;
}

export function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function toolRange(args: unknown): string {
	const record = asRecord(args);
	if (!record || typeof record.offset !== "number") return "";
	if (typeof record.limit !== "number") return `:${record.offset}`;
	return `:${record.offset}-${record.offset + record.limit - 1}`;
}

export function toolTarget(toolName: string, args: unknown): string {
	const record = asRecord(args);
	if (!record) return "";
	if (toolName === "bash") return stringValue(record.command);
	if (toolName === "grep") {
		const pattern = stringValue(record.pattern);
		const path = stringValue(record.path);
		return path ? `${pattern} in ${path}` : pattern;
	}
	if (toolName === "find") {
		const pattern = stringValue(record.pattern);
		const path = stringValue(record.path);
		return path ? `${pattern} in ${path}` : pattern;
	}
	return shortenPath(stringValue(record.path) || stringValue(record.file_path));
}

export function formatToolStart(
	toolName: string,
	args: unknown,
): { text: string; format?: "pre" | "diff" | "code" | "output" } {
	const record = asRecord(args);
	if (!record) return { text: summarizeValue(args), format: "pre" };
	if (toolName === "bash") return { text: "", format: "pre" };
	if (toolName === "edit") {
		const count = Array.isArray(record.edits) ? record.edits.length : 0;
		return {
			text: `${count} replacement${count === 1 ? "" : "s"}`,
			format: "output",
		};
	}
	return { text: "", format: "pre" };
}

export function formatToolResult(
	toolName: string,
	result: unknown,
	options: { args?: unknown; isError?: boolean } = {},
): { text: string; format?: "pre" | "diff" | "code" | "output" } {
	const text = extractToolText(result);
	if (options.isError) {
		return { text: compactToolOutput(text), format: "output" };
	}
	const record = asRecord(result);
	const details = asRecord(record?.details);
	if (toolName === "edit" && typeof details?.patch === "string") {
		return { text: details.patch, format: "diff" };
	}
	if (toolName === "edit" && typeof details?.diff === "string") {
		return { text: details.diff, format: "diff" };
	}
	if (/^\(no output\)$/i.test(text.trim())) {
		return { text: "", format: "pre" };
	}
	if (toolName === "read") {
		return { text: "", format: "pre" };
	}
	if (toolName === "bash") {
		if (!options.isError && shouldHideBashOutput(options.args)) {
			const count = countBashResults(text);
			return {
				text: `${count} result${count === 1 ? "" : "s"}`,
				format: "output",
			};
		}
		return { text: compactToolOutput(text), format: "output" };
	}
	return { text, format: "output" };
}

export function shortenPath(path: string): string {
	return formatHomePath(path);
}

export function compactReadOutput(text: string): string {
	return text
		.replace(/\n\n\[[^\]]*more lines in file[\s\S]*?\]$/i, "")
		.replace(/\n\n\[Showing lines [^\]]+\]$/i, "")
		.trimEnd();
}

export function shouldHideBashOutput(args: unknown): boolean {
	const command = stringValue(asRecord(args)?.command).trimStart();
	const executable = command.match(
		/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:\S+\/)?([^\s;|&]+)/,
	)?.[1];
	return executable !== undefined && hiddenBashOutputCommands.has(executable);
}

export function countBashResults(text: string): number {
	return text
		.trim()
		.split("\n")
		.filter((line) => line.trim() && !/^\[(?:Showing|Output truncated)/.test(line))
		.length;
}

export function compactToolOutput(text: string): string {
	const trimmed = text.trimEnd();
	const lines = trimmed.split("\n");
	if (lines.length <= bashCompactThreshold) {
		return trimmed;
	}
	const skipped = lines.length - bashPreviewLines;
	return `... (${skipped} earlier lines)\n${lines.slice(-bashPreviewLines).join("\n")}`;
}

export function extractToolText(result: unknown): string {
	const record = asRecord(result);
	if (record?.content !== undefined) {
		const text = contentToText(record.content);
		if (text.trim()) return text;
		if (Array.isArray(record.content) && record.content.length === 0) return "";
	}
	if (record?.text !== undefined) {
		return stripAnsi(String(record.text));
	}
	if (result instanceof Error) {
		return result.message;
	}
	if (typeof result === "string") {
		return stripAnsi(result);
	}
	return summarizeValue(result);
}

export function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

export function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return stripAnsi(content);
	}
	if (!Array.isArray(content)) {
		return summarizeValue(content);
	}
	return content
		.map((part) => {
			if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
				return stripAnsi(part.text);
			}
			if (isRecord(part) && part.type === "image") {
				return `[image: ${String(part.mimeType ?? "unknown")}]`;
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

const ansiPattern = new RegExp(
	String.raw`[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))`,
	"g",
);

export function stripAnsi(value: string): string {
	return value.replace(ansiPattern, "");
}

export function summarizeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
