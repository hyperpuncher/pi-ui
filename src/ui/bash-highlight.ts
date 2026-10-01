import type { NestedToolCalls } from "@earendil-works/pi-ai";
import {
	getFiletypeFromFileName,
	getHighlighterIfLoaded,
	type ThemedToken,
} from "@pierre/diffs";
import { flatTokenVariants } from "shiki/core";

import { getActiveCodeThemeId, getPierreThemes } from "../pierre-theme.ts";
import type { JsonObject, JsonValue } from "../utils/json-types.ts";
import { isRecord, isString } from "../utils/type-guards.ts";
import { loadPierreLanguage } from "./diffs.ts";
import { BoundedCache } from "./render-cache.ts";

// Share script tokens across commands with different wrappers, arguments or redirects.
const scriptTokens = new BoundedCache<string, ThemedToken[]>(128, {
	maxWeight: 2 * 1024 * 1024,
	weight: (key, tokens) => key.length * 2 + tokens.length * 256,
});

const embeddedLanguages = new Set([
	"python",
	"javascript",
	"typescript",
	"rust",
	"sql",
	"bash",
	"lua",
	"html",
	"css",
	"xml",
	"jsx",
	"tsx",
	"svelte",
	"astro",
	"json",
	"jsonc",
	"yaml",
	"toml",
	"go",
	"markdown",
	"diff",
	"typst",
]);
const markerLanguages = new Map(
	Object.entries({
		PY: "python",
		PYTHON: "python",
		PYEOF: "python",
		JS: "javascript",
		NODE: "javascript",
		TS: "typescript",
		BUN: "typescript",
		ENDTS: "typescript",
		RS: "rust",
		RUST: "rust",
		RUSTEOF: "rust",
		ENDRS: "rust",
		ENDRUST: "rust",
		SQL: "sql",
		SH: "bash",
		BASH: "bash",
		LUA: "lua",
		HTML: "html",
		CSS: "css",
		XML: "xml",
		SVG: "xml",
		FONTCONFIG: "xml",
		JSON: "json",
		PKGJSON: "json",
		YAML: "yaml",
		TOML: "toml",
		PATCH: "diff",
	}),
);
const wrappers = new Set(["uv", "env", "sudo", "timeout", "direnv"]);
const heredocOperator = "keyword.operator.heredoc.shell";
const heredocDelimiter = "punctuation.definition.string.heredoc.delimiter.shell";
type Explanation = NonNullable<ThemedToken["explanation"]>[number];
type ShellPart = Explanation & { offset: number };
type Script = {
	start: number;
	end: number;
	language: string;
	value?: string;
	quote?: string;
};
export type CodeSnippet = { field: string; value: string; language: string };

export function codeSnippets(
	nested: NestedToolCalls | undefined,
	maxLength = Infinity,
): CodeSnippet[] {
	const snippets: CodeSnippet[] = [];
	function visit(value: JsonValue | undefined, inherited?: string) {
		if (Array.isArray(value)) {
			for (const item of value) visit(item, inherited);
			return;
		}
		if (!isRecord(value)) return;
		// SAFETY: pi provides JSON values; the record guard excludes primitives and arrays.
		const args = value as JsonObject;
		const explicit = isString(args.language)
			? args.language
			: isString(args.lang)
				? args.lang
				: "";
		const path = isString(args.path)
			? args.path
			: isString(args.file_path)
				? args.file_path
				: "";
		const detected = explicit
			? embeddedLanguages.has(explicit)
				? explicit
				: getFiletypeFromFileName(`snippet.${explicit}`)
			: path
				? getFiletypeFromFileName(path)
				: undefined;
		const language = detected && detected !== "text" ? detected : inherited;
		for (const [field, body] of Object.entries(args)) {
			if (
				isString(body) &&
				/^(content|oldText|newText|code|script|function|command)$/.test(field)
			) {
				const lang = language ?? (field === "command" ? "bash" : undefined);
				if (lang && body.length <= maxLength)
					snippets.push({ field, value: body, language: lang });
			} else visit(body, language);
		}
	}
	for (const call of nested?.calls ?? []) visit(call.arguments);
	return snippets;
}

function encodeLiteral(value: string, quote: string, next = ""): string {
	if (quote === "`") return value;
	if (quote === "template") {
		const encoded = value
			.replaceAll("\\", "\\\\")
			.replaceAll("`", "\\`")
			.replaceAll("${", "\\${");
		// An embedded lexer can split $ and { into separate tokens.
		return value.endsWith("$") && next === "{"
			? encoded.slice(0, -1) + "\\$"
			: encoded;
	}
	const encoded = JSON.stringify(value).slice(1, -1);
	return quote === "'"
		? encoded.replaceAll('\\\"', '"').replaceAll("'", "\\'")
		: encoded;
}

export function hasEmbeddedBash(command: string): boolean {
	return /<<|(?:^|\s)(?:-[np]*[epc]\b|--(?:eval|print)\b|eval\b)|\b(?:awk|gawk|mawk)\b|\bplaywright-cli\s+(?:-s=\S+\s+)?run-code\b/.test(
		command,
	);
}

export async function loadBashLanguages(command: string): Promise<void> {
	if (!hasEmbeddedBash(command)) return;
	if (!(await loadPierreLanguage("bash"))) return;
	const tokens = bashTokens(command);
	if (!tokens) return;
	const languages = new Set([
		...heredocs(command, tokens).map((block) => block.language),
		...inlineScripts(command, tokens).map((script) => script.language),
	]);
	await Promise.all([...languages].map(loadPierreLanguage));
}

function bashTokens(command: string, format = false): ThemedToken[][] | undefined {
	return getHighlighterIfLoaded()?.codeToTokens(command, {
		lang: "bash",
		themes: getPierreThemes(),
		includeExplanation:
			hasEmbeddedBash(command) ||
			(format && command.length > 90 && /[;&|]/.test(command))
				? "scopeName"
				: false,
	}).tokens;
}

export function highlightBash(
	command: string,
	options: { format?: boolean } = {},
): { tokens: ThemedToken[][]; missingLanguages: string[] } | undefined {
	const highlighter = getHighlighterIfLoaded();
	const tokens = bashTokens(command, options.format);
	if (!highlighter || !tokens) return undefined;
	const breaks = options.format ? displayBreaks(command, tokens) : [];
	return highlightScripts(
		command,
		tokens,
		[...heredocs(command, tokens), ...inlineScripts(command, tokens)],
		breaks,
	);
}

export function highlightCodemode(code: string, snippets: CodeSnippet[] = []) {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return undefined;
	const key = `${getActiveCodeThemeId()}\0codemode\0${code}`;
	let base = scriptTokens.get(key);
	if (!base) {
		base = highlighter
			.codeToTokensWithThemes(code, {
				lang: "javascript",
				themes: getPierreThemes(),
				includeExplanation: "tokenType",
				tokenizeTimeLimit: 0,
			})
			.flat()
			.map((token) => {
				// SAFETY: tokenType metadata is retained in variants by Shiki, though TokenStyles omits it.
				const typed = token.variants.light as Pick<ThemedToken, "type">;
				return {
					...flatTokenVariants(token, ["light", "dark"], "--shiki-", "light"),
					type: typed.type,
				};
			});
		scriptTokens.set(key, base);
	}

	const hints = new Map<string, CodeSnippet | null>();
	for (const snippet of snippets)
		for (const quote of ['"', "'", "`", "template"]) {
			const key = `${snippet.field}\0${quote}\0${encodeLiteral(snippet.value, quote)}`;
			const previous = hints.get(key);
			hints.set(
				key,
				previous === null || (previous && previous.language !== snippet.language)
					? null
					: snippet,
			);
		}
	const scripts: Script[] = [];
	for (let index = 0; index < base.length; index++) {
		const token = base[index]!;
		const quote = code[token.offset];
		// TextMate's string token type excludes comments and regular expressions.
		if (token.type !== 2 || !quote || !['"', "'", "`"].includes(quote)) continue;
		const end = stringEnd(code, token.offset + 1, quote);
		if (end < 0) continue;
		const prefix = code.slice(Math.max(0, token.offset - 80), token.offset);
		const body = code.slice(token.offset + 1, end);
		const field = prefix.match(
			/["']?\b(content|oldText|newText|code|script|function|command)["']?\s*:\s*(String\.raw\s*)?$/,
		);
		const encoding = quote === "`" && !field?.[2] ? "template" : quote;
		const snippet = field
			? hints.get(`${field[1]}\0${encoding}\0${body}`)
			: undefined;
		const call = prefix.match(
			/\btools\.(bash|\w*browser_run_code)\s*\(\s*\{[^{}]*\b(command|code)\s*:\s*$/,
		);
		const interpolated =
			quote === "`" &&
			[...body.matchAll(/\$\{/g)].some((match) => !isEscaped(body, match.index));
		const language =
			snippet?.language ??
			(call &&
			(call[1] === "bash" ? call[2] === "command" : call[2] === "code") &&
			!body.includes("\\")
				? call[1] === "bash"
					? "bash"
					: "javascript"
				: undefined);
		if (language && !interpolated)
			scripts.push({
				start: token.offset + 1,
				end,
				language,
				value: snippet?.value,
				quote: snippet ? encoding : undefined,
			});
		while (index + 1 < base.length && base[index + 1]!.offset <= end) index++;
	}
	return highlightScripts(code, tokenLines(code, base, []), scripts);
}

function stringEnd(code: string, start: number, quote: string): number {
	let end = code.indexOf(quote, start);
	while (end >= 0) {
		if (!isEscaped(code, end)) return end;
		end = code.indexOf(quote, end + 1);
	}
	return -1;
}

function isEscaped(code: string, offset: number): boolean {
	let slashes = 0;
	for (let index = offset - 1; code[index] === "\\"; index--) slashes++;
	return slashes % 2 !== 0;
}

function highlightScripts(
	command: string,
	tokens: ThemedToken[][],
	scripts: Script[],
	breaks: number[] = [],
) {
	const highlighter = getHighlighterIfLoaded()!;
	const loadedLanguages = new Set(highlighter.getLoadedLanguages());
	const missingLanguages = new Set<string>();
	scripts.sort((a, b) => a.start - b.start);
	const source = tokens.flat();
	const highlighted: ThemedToken[] = [];
	let index = 0;
	for (const { start, end, language, value, quote } of scripts) {
		if (!loadedLanguages.has(language)) {
			missingLanguages.add(language);
			continue;
		}
		const code = value ?? command.slice(start, end);
		const key = `${getActiveCodeThemeId()}\0${language}\0${code}`;
		let body = scriptTokens.get(key);
		if (!body) {
			try {
				if (language === "bash") {
					const result = highlightBash(code)!;
					body = result.tokens.flat();
					for (const missing of result.missingLanguages)
						missingLanguages.add(missing);
					if (!result.missingLanguages.length) scriptTokens.set(key, body);
				} else {
					body = highlighter
						.codeToTokens(code, { lang: language, themes: getPierreThemes() })
						.tokens.flat();
					scriptTokens.set(key, body);
				}
			} catch {
				continue;
			}
		}
		while (
			index < source.length &&
			source[index]!.offset + source[index]!.content.length <= start
		)
			highlighted.push(source[index++]!);
		const head = source[index];
		if (head && head.offset < start)
			highlighted.push({
				...head,
				content: head.content.slice(0, start - head.offset),
			});
		let decodedOffset = 0;
		let encodedOffset = start;
		for (const token of body) {
			if (value !== undefined && quote) {
				const gap = encodeLiteral(
					code.slice(decodedOffset, token.offset),
					quote,
					code[token.offset],
				);
				if (gap)
					highlighted.push({ ...head!, offset: encodedOffset, content: gap });
				encodedOffset += gap.length;
				const content = encodeLiteral(
					token.content,
					quote,
					code[token.offset + token.content.length],
				);
				highlighted.push({ ...token, offset: encodedOffset, content });
				encodedOffset += content.length;
				decodedOffset = token.offset + token.content.length;
			} else highlighted.push({ ...token, offset: token.offset + start });
		}
		if (value !== undefined && quote && encodedOffset < end)
			highlighted.push({
				...head!,
				offset: encodedOffset,
				content: command.slice(encodedOffset, end),
			});
		while (
			index < source.length &&
			source[index]!.offset + source[index]!.content.length <= end
		)
			index++;
		const tail = source[index];
		if (tail && tail.offset < end)
			source[index] = {
				...tail,
				offset: end,
				content: tail.content.slice(end - tail.offset),
			};
	}
	for (; index < source.length; index++) highlighted.push(source[index]!);
	return {
		tokens: tokenLines(command, highlighted, breaks),
		missingLanguages: [...missingLanguages],
	};
}

function heredocs(command: string, tokens: ThemedToken[][]) {
	const blocks: Script[] = [];
	if (!command.includes("<<")) return blocks;
	const lines = command.split(/\r?\n/);
	let offset = 0;
	const offsets = command.split("\n").map((line) => {
		const start = offset;
		offset += line.length + 1;
		return start;
	});
	for (let index = 0; index < tokens.length; index++) {
		const header = explanations(tokens[index] ?? []);
		const operators = header.filter((part) => hasScope(part, heredocOperator));
		// Multiple queued heredocs are not reliably represented by the bash grammar.
		if (operators.length !== 1 || (lines[index]?.match(/<</g)?.length ?? 0) !== 1)
			continue;
		const marker = header.find((part) => hasScope(part, heredocDelimiter))?.content;
		if (!marker) continue;
		const language = heredocLanguage(header, marker);
		if (!language) continue;
		const indent = operators[0]?.content === "<<-";
		let end = index + 1;
		for (; end < tokens.length; end++) {
			const line = lines[end] ?? "";
			if ((indent ? line.replace(/^\t+/, "") : line) === marker) break;
			const parts = explanations(tokens[end] ?? []);
			if (
				parts.some(
					(part) =>
						!part.scopes.some(
							({ scopeName }) =>
								scopeName ===
									`string.quoted.heredoc.${indent ? "indent" : "no-indent"}.${marker}` ||
								scopeName ===
									`string.unquoted.heredoc.${indent ? "indent" : "no-indent"}.${marker}`,
						),
				)
			)
				break;
		}
		// Only replace complete blocks whose boundaries agree with the grammar.
		if (
			end >= lines.length ||
			(indent ? lines[end]?.replace(/^\t+/, "") : lines[end]) !== marker
		)
			continue;
		if (end === index + 1) continue;
		const bodyEnd = offsets[end]! - (command[offsets[end]! - 2] === "\r" ? 2 : 1);
		blocks.push({ start: offsets[index + 1]!, end: bodyEnd, language });
		index = end;
	}
	return blocks;
}

function explanations(tokens: ThemedToken[]): Explanation[] {
	return tokens.flatMap((token) => token.explanation ?? []);
}

function hasScope(part: Explanation, name: string): boolean {
	return part.scopes.some(({ scopeName }) => scopeName === name);
}

function heredocLanguage(header: Explanation[], marker: string): string | undefined {
	const operator = header.findIndex((part) => hasScope(part, heredocOperator));
	const separator = (part: Explanation) =>
		part.scopes.some(
			({ scopeName }) =>
				scopeName.startsWith("punctuation.separator.statement.") ||
				scopeName === "punctuation.terminator.statement.semicolon.shell",
		);
	let start = operator;
	while (
		start > 0 &&
		!separator(header[start - 1]!) &&
		!hasScope(header[start - 1]!, "keyword.operator.pipe.shell")
	)
		start--;
	let end = operator + 1;
	while (end < header.length && !separator(header[end]!)) end++;
	const parts = header.slice(start, end);
	let wrapped = false;
	let writesFile = false;
	for (const part of parts) {
		const isCommand = hasScope(part, "entity.name.command.shell");
		if (!isCommand && !(wrapped && hasScope(part, "string.unquoted.argument.shell")))
			continue;
		const name = part.content.split("/").at(-1) ?? "";
		if (isCommand) wrapped = wrappers.has(name);
		if (name === "cat" || name === "tee") writesFile = true;
		if (/^python(?:\d+(?:\.\d+)*)?$/.test(name)) return "python";
		if (name === "node") return "javascript";
		if (name === "bun" || name === "deno") return "typescript";
		if (name === "psql" || name === "sqlite3") return "sql";
		if (name === "lua") return "lua";
		if (name === "bash" || name === "sh" || name === "zsh") return "bash";
	}
	if (writesFile) {
		const text = parts.map((part) => part.content).join("");
		const filename = text.match(
			/(?:>{1,2}\s*|\btee\s+(?:-a\s+)?)(?:"([^"]+)"|'([^']+)'|([^\s<>|;&]+))/,
		);
		const path = filename?.[1] ?? filename?.[2] ?? filename?.[3];
		if (path) {
			let language = getFiletypeFromFileName(path);
			if (
				/\.(?:svg|xml)$/.test(path) ||
				/(?:^|\/)fonts\.conf$/.test(path) ||
				path.includes("fontconfig/")
			)
				language = "xml";
			if (language === "zsh" || /(?:^|\/)\.zshrc$/.test(path)) language = "bash";
			if (embeddedLanguages.has(language)) return language;
		}
	}
	return markerLanguages.get(marker);
}

function shellParts(tokens: ThemedToken[][]): ShellPart[] {
	const parts: ShellPart[] = [];
	for (const line of tokens)
		for (const token of line) {
			let offset = token.offset;
			for (const part of token.explanation ?? []) {
				parts.push({ content: part.content, scopes: part.scopes, offset });
				offset += part.content.length;
			}
		}
	return parts;
}

function isShellSyntax(part: Explanation): boolean {
	return !part.scopes.some(
		({ scopeName }) =>
			scopeName.startsWith("string.quoted.") ||
			scopeName.startsWith("string.unquoted.heredoc.") ||
			scopeName.startsWith("comment."),
	);
}

function inlineScripts(command: string, tokens: ThemedToken[][]): Script[] {
	const scripts: Script[] = [];
	if (!hasEmbeddedBash(command)) return scripts;
	const parts = shellParts(tokens);
	for (let index = 0; index < parts.length; index++) {
		const opening = parts[index]!;
		if (
			!hasScope(opening, "punctuation.definition.string.begin.shell") ||
			!["'", '"'].includes(opening.content)
		)
			continue;
		if (opening.scopes.some(({ scopeName }) => scopeName.includes("heredoc")))
			continue;
		const end = parts.findIndex(
			(part, candidate) =>
				candidate > index &&
				hasScope(part, "punctuation.definition.string.end.shell"),
		);
		if (end < 0) continue;
		const closing = parts[end]!;
		if (closing.content !== opening.content) continue;
		const start = opening.offset + 1;
		const code = command.slice(start, closing.offset);
		// Highlight literal arguments only, never shell expansions or concatenated words.
		if (!code || (opening.content === '"' && /[$`\\]/.test(code))) continue;
		if (
			command[opening.offset - 1] === "$" ||
			/[^\s;|&)]/.test(command[closing.offset + 1] ?? "")
		)
			continue;
		let commandIndex = index - 1;
		while (
			commandIndex >= 0 &&
			!hasScope(parts[commandIndex]!, "entity.name.command.shell")
		)
			commandIndex--;
		if (commandIndex < 0) continue;
		const executable = parts[commandIndex]!;
		if (!isShellSyntax(executable)) continue;
		let name = executable.content.split("/").at(-1) ?? "";
		let interpreter = executable;
		if (wrappers.has(name)) {
			const target = parts
				.slice(commandIndex + 1, index)
				.findLast(
					(part) =>
						hasScope(part, "string.unquoted.argument.shell") &&
						inlineLanguage(part.content.split("/").at(-1) ?? ""),
				);
			if (!target) continue;
			interpreter = target;
			name = target.content.split("/").at(-1) ?? "";
		}
		const language = inlineLanguage(name);
		if (!language) continue;
		const prefix = command
			.slice(interpreter.offset + interpreter.content.length, opening.offset)
			.replace(/\\\r?\n/g, " ");
		if (/\n|(?:^|\s)--(?:\s|$)/.test(prefix)) continue;
		let isScript = false;
		if (language === "python") isScript = /^\s+(?:-[A-Za-z]+\s+)*-c\s*$/.test(prefix);
		else if (name === "playwright-cli")
			isScript = /^\s+(?:-s=\S+\s+)?run-code\s+$/.test(prefix);
		else if (name === "deno") isScript = /^\s+eval(?:\s+--[\w=-]+)*\s+$/.test(prefix);
		else if (["node", "bun"].includes(name))
			isScript =
				/^\s+(?:--[\w-]+(?:=[^\s'"]+)?\s+)*(?:-[ep]|--(?:eval|print)=?)\s*$/.test(
					prefix,
				);
		else if (["ruby", "perl", "lua"].includes(name))
			isScript = /^\s+(?:-[A-Za-z]+\s+)*-[np]*e\s*$/.test(prefix);
		else if (["awk", "gawk", "mawk"].includes(name)) {
			isScript =
				/^(?:\s+-[^\s'"]+)*\s+$/.test(prefix) &&
				!/(?:^|\s)(?:-[fv]|--(?:file|assign)\b)/.test(prefix);
		}
		if (isScript) scripts.push({ start, end: closing.offset, language });
		index = end;
	}
	return scripts;
}

function inlineLanguage(name: string): string | undefined {
	if (/^python(?:\d+(?:\.\d+)*)?$/.test(name)) return "python";
	if (name === "bun" || name === "deno") return "typescript";
	if (name === "node" || name === "playwright-cli") return "javascript";
	if (name === "gawk" || name === "mawk") return "awk";
	if (["ruby", "perl", "lua", "awk"].includes(name)) return name;
	return undefined;
}

/** Use the original shell scopes before embedded highlighting replaces them. */
function displayBreaks(command: string, tokens: ThemedToken[][]): number[] {
	const breaks: number[] = [];
	if (command.length <= 90) return breaks;
	for (const line of tokens) {
		const parts = shellParts([line]);
		// Breaking a heredoc declaration line would move the start of its body.
		if (parts.some((part) => hasScope(part, heredocOperator))) continue;
		for (const part of parts) {
			if (!isShellSyntax(part)) continue;
			if (
				[
					"punctuation.separator.statement.and.shell",
					"punctuation.separator.statement.or.shell",
					"punctuation.terminator.statement.semicolon.shell",
					"punctuation.terminator.statement.case.shell",
					"keyword.operator.pipe.shell",
				].some((scope) => hasScope(part, scope))
			) {
				if ((breaks.at(-1) ?? -1) > part.offset) continue;
				// The grammar splits some compound operators, notably |&.
				const operator =
					command
						.slice(part.offset)
						.match(/^(?:;;&|&&|\|\||\|&|;;|;&|\||;)/)?.[0] ?? part.content;
				breaks.push(part.offset + operator.length);
			}
		}
	}
	return breaks.filter((offset) => !/^[ \t]*(?:\r?\n|$)/.test(command.slice(offset)));
}

/** One ordered pass handles both original newlines and display-only breaks. */
function tokenLines(
	command: string,
	tokens: ThemedToken[],
	breaks: number[],
): ThemedToken[][] {
	const cuts = [...command.matchAll(/\r?\n/g)].map((match) => ({
		end: match.index,
		next: match.index + match[0].length,
	}));
	for (const end of breaks)
		cuts.push({
			end,
			next: end + (command.slice(end).match(/^[ \t]*/)?.[0].length ?? 0),
		});
	cuts.sort((a, b) => a.end - b.end);
	cuts.push({ end: command.length, next: command.length });
	const lines: ThemedToken[][] = [];
	let index = 0;
	let start = 0;
	for (const { end, next } of cuts) {
		const line: ThemedToken[] = [];
		while (index < tokens.length && tokens[index]!.offset < end) {
			const token = tokens[index]!;
			const from = Math.max(start, token.offset);
			const to = Math.min(end, token.offset + token.content.length);
			if (from < to)
				line.push(
					from === token.offset && to === token.offset + token.content.length
						? token
						: {
								...token,
								offset: from,
								content: token.content.slice(
									from - token.offset,
									to - token.offset,
								),
							},
				);
			if (token.offset + token.content.length > end) break;
			index++;
		}
		lines.push(line);
		start = next;
	}
	return lines;
}
