import { stripAnsi } from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/ansi.js";
import type { TranscriptMessageTitlePart } from "../state/transcript-state.ts";
import type { JsonValue } from "../utils/json-types.ts";
import {
	asRecord,
	isNumber,
	isRecord,
	isString,
	type JsonRecord,
} from "../utils/type-guards.ts";
import { formatHomePath } from "../utils/workspace.ts";

const bashPreviewLines = 4;
const bashCompactThreshold = 7;
const hiddenBashOutputCommands = new Set(["fd", "find", "grep", "ls", "rg", "tree"]);

type ToolPresentation = {
	text: string;
	format?: "pre" | "diff" | "code" | "output";
};

export function toolTitleParts(
	toolName: string,
	args: JsonValue,
): TranscriptMessageTitlePart[] {
	const record = asRecord(args);
	if (toolName === "bash" && record) {
		const timeout = isNumber(record.timeout) ? ` timeout ${record.timeout}s` : "";
		return [
			{ text: "$ ", tone: "accent", mono: true },
			{
				text: stringValue(record.command) || "...",
				mono: true,
				highlight: "bash",
			},
			...(timeout ? [{ text: timeout, tone: "muted", mono: true } as const] : []),
		];
	}

	const target = toolTarget(toolName, args);
	const range = toolRange(args);
	return [
		{ text: toolName },
		...(target ? [{ text: target, tone: "accent", mono: true } as const] : []),
		...(range ? [{ text: range, tone: "muted", mono: true } as const] : []),
	];
}

export function toolTitle(
	status: "running" | "success" | "error",
	toolName: string,
	args: JsonValue,
): string {
	const record = asRecord(args);
	if (toolName === "bash" && record) {
		const timeout = isNumber(record.timeout) ? ` timeout ${record.timeout}s` : "";
		return `$ ${stringValue(record.command) || "..."}${timeout}`;
	}

	const verb = toolName;
	const target = toolTarget(toolName, args);
	return target ? `${verb} ${target}${toolRange(args)}` : verb;
}

export function toolMeta(toolName: string, args: JsonValue): string | undefined {
	const edits = asRecord(args)?.edits;
	if (toolName !== "edit" || !Array.isArray(edits)) return undefined;
	return `${edits.length} edit${edits.length === 1 ? "" : "s"}`;
}

export function toolEndMeta(startedAt: number | undefined): string | undefined {
	if (startedAt === undefined) return undefined;
	const duration = formatDuration(Date.now() - startedAt);
	return duration === "0.0s" ? undefined : duration;
}

function formatDuration(ms: number): string {
	if (ms <= 60_000) return `${(ms / 1000).toFixed(1)}s`;

	const totalSeconds = Math.round(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds}s`;
}

function toolRange(args: JsonValue): string {
	const record = asRecord(args);
	if (!record || !isNumber(record.offset)) return "";
	if (!isNumber(record.limit)) return `:${record.offset}`;
	return `:${record.offset}-${record.offset + record.limit - 1}`;
}

// Extension tools (subagent_*, ask_user, jev_decompose, advisor, todo, goal_*, delegate*,
// memory_*, web_search/fetch_content/source_check/get_search_content, mcp__*) have no
// built-in special case above and no `path`/`file_path` argument for the fallback below to
// find, so their title reads as just the bare tool name. Rather than hardcoding each
// extension's argument shape one by one, this small table names, per tool-name pattern,
// which argument key(s) are likely to hold a human-meaningful "target" — the same role
// `command`/`pattern`/`path` play for the built-ins above. First match wins; first
// non-empty key wins. New extension tools not listed here still get a sensible title (the
// bare tool name), so this table is an enhancement, never a requirement.
const extensionToolTargets: readonly {
	pattern: RegExp;
	argKeys: readonly string[];
}[] = [
	{ pattern: /^ask_user$/, argKeys: ["question"] },
	{ pattern: /^subagent_start$/, argKeys: ["tasks"] },
	{ pattern: /^subagent_/, argKeys: ["id", "ids", "jobId"] },
	{ pattern: /^jev_decompose$/, argKeys: ["workstreams"] },
	{ pattern: /^advisor$/, argKeys: ["request", "purpose"] },
	{ pattern: /^todo$/, argKeys: ["action", "subject"] },
	{ pattern: /^goal_/, argKeys: ["objective", "step", "reason"] },
	{ pattern: /^delegate/i, argKeys: ["task", "objective"] },
	{ pattern: /^memory_/, argKeys: ["key", "query"] },
	{
		pattern: /^(?:web_search|source_check|fetch_content|get_search_content)$/,
		argKeys: ["query", "url"],
	},
	{ pattern: /^mcp__/, argKeys: ["query", "path", "id", "name"] },
];

function extensionToolTarget(toolName: string, record: JsonRecord): string {
	const spec = extensionToolTargets.find((entry) => entry.pattern.test(toolName));
	if (!spec) return "";
	for (const key of spec.argKeys) {
		const value = record[key];
		if (isString(value) && value.trim()) return value.trim();
		if (Array.isArray(value) && value.length > 0) return `${value.length} ${key}`;
	}
	return "";
}

function toolTarget(toolName: string, args: JsonValue): string {
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
	const path = formatHomePath(
		stringValue(record.path) || stringValue(record.file_path),
	);
	return path || extensionToolTarget(toolName, record);
}

export function formatToolStart(toolName: string, args: JsonValue): ToolPresentation {
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

export function formatToolResult<Result>(
	toolName: string,
	result: Result,
	options: { args?: JsonValue; isError?: boolean } = {},
): ToolPresentation {
	const text = extractToolText(result);
	if (options.isError) {
		return { text: compactToolOutput(text), format: "output" };
	}
	const record = asRecord(result);
	const details = asRecord(record?.details);
	if (toolName === "edit" && isString(details?.patch)) {
		return { text: details.patch, format: "diff" };
	}
	if (toolName === "edit" && isString(details?.diff)) {
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

function shouldHideBashOutput(args: JsonValue | undefined): boolean {
	const command = stringValue(asRecord(args)?.command).trimStart();
	const executable = command.match(
		/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:\S+\/)?([^\s;|&]+)/,
	)?.[1];
	return executable !== undefined && hiddenBashOutputCommands.has(executable);
}

function countBashResults(text: string): number {
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

function extractToolText<Result>(result: Result): string {
	const record = asRecord(result);
	if (record?.content !== undefined) {
		const text = contentToText(record.content);
		if (text.trim()) return text;
		if (Array.isArray(record.content) && record.content.length === 0) return "";
	}
	if (record?.text !== undefined) {
		return stripAnsi(String(record.text));
	}
	if (Error.isError(result)) {
		return result.message;
	}
	if (isString(result)) {
		return stripAnsi(result);
	}
	return summarizeValue(result);
}

function stringValue<Value>(value: Value): string {
	return isString(value) ? value : "";
}

export function contentToText<Content>(content: Content): string {
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

export { stripAnsi };

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
