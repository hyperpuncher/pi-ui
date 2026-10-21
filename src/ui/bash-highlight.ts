import type { NestedToolCalls } from "@earendil-works/pi-ai";
import {
	getFiletypeFromFileName,
	getHighlighterIfLoaded,
	type ThemedToken,
} from "@pierre/diffs";
import { isSupportedLanguage } from "@pierre/highlights";

import { activeCodeThemes, codeThemeKey } from "#src/pierre-theme.ts";
import { BoundedCache } from "#src/ui/render-cache.ts";
import {
	isInRanges,
	lineSegments,
	scanShell,
	type ShellHeredoc,
	type ShellLine,
	type ShellSegment,
	type ShellWord,
} from "#src/ui/shell-scanner.ts";
import type { JsonObject, JsonValue } from "#src/utils/json-types.ts";
import { isRecord, isString } from "#src/utils/type-guards.ts";

// Share script tokens across commands with different wrappers, arguments or redirects.
const scriptTokens = new BoundedCache<string, ThemedToken[]>(128, {
	maxWeight: 2 * 1024 * 1024,
	weight: (key, tokens) => key.length * 2 + tokens.length * 256,
});

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
const breakOperators = new Set([";", ";;", ";&", ";;&", "&&", "||", "|", "|&"]);
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
			? isSupportedLanguage(explicit)
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
	if (quote === "shell") return value.replaceAll("'", "'\\''");
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
	return /<<|(?:^|\s)(?:-[np]*[epc]\b|--(?:eval|print)\b|eval\b)|\bplaywright-cli\s+(?:-s=\S+\s+)?run-code\b/.test(
		command,
	);
}

function bashTokens(command: string): ThemedToken[][] | undefined {
	return getHighlighterIfLoaded()?.codeToTokens(command, {
		lang: "bash",
		themes: activeCodeThemes,
		defaultColor: "light-dark()",
	}).tokens;
}

export function highlightBash(
	command: string,
	options: { format?: boolean } = {},
): { tokens: ThemedToken[][] } | undefined {
	const tokens = bashTokens(command);
	if (!tokens) return undefined;
	const format = options.format === true && command.length > 90;
	const scan = hasEmbeddedBash(command) ? scanShell(command) : undefined;
	const breaks = format ? displayBreaks(command, tokens, scan?.bodyRanges ?? []) : [];
	return highlightScripts(
		command,
		tokens,
		scan ? [...heredocs(scan), ...inlineScripts(command, scan)] : [],
		breaks,
	);
}

export function highlightCodemode(code: string, snippets: CodeSnippet[] = []) {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return undefined;
	const key = `${codeThemeKey()}\0codemode\0${code}`;
	let base = scriptTokens.get(key);
	if (!base) {
		base = highlighter
			.codeToTokens(code, {
				lang: "javascript",
				themes: activeCodeThemes,
				defaultColor: "light-dark()",
			})
			.tokens.flat();
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
	scripts.sort((a, b) => a.start - b.start);
	const source = tokens.flat();
	const highlighted: ThemedToken[] = [];
	let index = 0;
	for (const { start, end, language, value, quote } of scripts) {
		const code = value ?? command.slice(start, end);
		const key = `${codeThemeKey()}\0${language}\0${code}`;
		let body = scriptTokens.get(key);
		if (!body) {
			try {
				if (language === "bash") {
					body = highlightBash(code)!.tokens.flat();
					scriptTokens.set(key, body);
				} else {
					body = highlighter
						.codeToTokens(code, {
							lang: language,
							themes: activeCodeThemes,
							defaultColor: "light-dark()",
						})
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
	return { tokens: tokenLines(command, highlighted, breaks) };
}

function heredocs(scan: ReturnType<typeof scanShell>): Script[] {
	const blocks: Script[] = [];
	for (const heredoc of scan.heredocs) {
		const language = heredocLanguage(scan.lines[heredoc.lineIndex]!, heredoc);
		if (language) blocks.push({ start: heredoc.start, end: heredoc.end, language });
	}
	return blocks;
}

function heredocLanguage(line: ShellLine, heredoc: ShellHeredoc): string | undefined {
	const segments = lineSegments(line);
	let start = segments.findIndex(
		(segment, index) =>
			heredoc.operatorStart >= segment.start &&
			(index === segments.length - 1 ||
				heredoc.operatorStart < segments[index + 1]!.start),
	);
	if (start < 0) return markerLanguages.get(heredoc.marker);
	let end = start + 1;
	while (
		end < segments.length &&
		line.operators.some(
			(operator) =>
				operator.start >= segments[end - 1]!.end &&
				operator.end <= segments[end]!.start &&
				(operator.value === "|" || operator.value === "|&"),
		)
	)
		end += 1;
	for (const segment of segments.slice(start, end)) {
		const commandWord = effectiveCommand(segment);
		if (!commandWord) continue;
		const name = basename(commandWord.word.value);
		const language = commandLanguage(name);
		if (language) return language;
		if (name === "cat" || name === "tee") {
			const pathLanguage = languageFromPath(
				writtenPath(segment, commandWord.index),
			);
			if (pathLanguage) return pathLanguage;
		}
	}
	return markerLanguages.get(heredoc.marker);
}

type EffectiveCommand = { word: ShellWord; index: number };

const commandLanguages = new Map([
	["node", "javascript"],
	["playwright-cli", "javascript"],
	["bun", "typescript"],
	["deno", "typescript"],
	["psql", "sql"],
	["sqlite3", "sql"],
	["lua", "lua"],
	["bash", "bash"],
	["sh", "bash"],
	["zsh", "bash"],
]);

function effectiveCommand(segment: ShellSegment): EffectiveCommand | undefined {
	const index = segment.words.findIndex(
		(word) => !word.redirectedBy && !isAssignment(word.value),
	);
	if (index < 0) return undefined;
	const word = segment.words[index]!;
	return wrappers.has(basename(word.value))
		? wrapperTarget(segment, index)
		: { word, index };
}

function wrapperTarget(
	segment: ShellSegment,
	start: number,
): EffectiveCommand | undefined {
	for (let index = start + 1; index < segment.words.length; index++) {
		const word = segment.words[index]!;
		if (word.redirectedBy) continue;
		const name = basename(word.value);
		if (
			commandLanguage(name) ||
			inlineLanguage(name) ||
			name === "cat" ||
			name === "tee" ||
			name === "git"
		)
			return { word, index };
	}
	return undefined;
}

function commandLanguage(name: string): string | undefined {
	return /^python(?:\d+(?:\.\d+)*)?$/.test(name)
		? "python"
		: commandLanguages.get(name);
}

function writtenPath(segment: ShellSegment, commandIndex: number): string | undefined {
	for (const word of segment.words.slice(commandIndex + 1)) {
		if (word.redirectedBy === "<<" || word.redirectedBy === "<<-") continue;
		if (word.redirectedBy === ">" || word.redirectedBy === ">>") return word.value;
		if (word.value.startsWith("-")) continue;
		if (basename(segment.words[commandIndex]!.value) === "tee") return word.value;
	}
	return undefined;
}

function languageFromPath(path: string | undefined): string | undefined {
	if (!path) return undefined;
	let language = getFiletypeFromFileName(path);
	if (
		/\.(?:svg|xml)$/.test(path) ||
		/(?:^|\/)fonts\.conf$/.test(path) ||
		path.includes("fontconfig/")
	)
		language = "xml";
	if (language === "zsh" || /(?:^|\/)\.zshrc$/.test(path)) language = "bash";
	return language !== "text" && isSupportedLanguage(language) ? language : undefined;
}

function inlineScripts(command: string, scan: ReturnType<typeof scanShell>): Script[] {
	const scripts: Script[] = [];
	for (const line of scan.lines) {
		if (isInRanges(line.start, scan.bodyRanges)) continue;
		for (const segment of lineSegments(line)) {
			const commandWord = effectiveCommand(segment);
			if (!commandWord) continue;
			const script = segmentScript(command, segment, commandWord);
			if (script) scripts.push(script);
		}
	}
	return scripts;
}

function segmentScript(
	command: string,
	segment: ShellSegment,
	commandWord: EffectiveCommand,
): Script | undefined {
	const name = basename(commandWord.word.value);
	const language = inlineLanguage(name);
	if (!language) return undefined;
	for (const word of segment.words.slice(commandWord.index + 1)) {
		if (word.redirectedBy) continue;
		const script = wordScript(command, word, commandWord, name, language);
		if (script) return script;
	}
	return undefined;
}

function wordScript(
	command: string,
	word: ShellWord,
	commandWord: EffectiveCommand,
	name: string,
	language: string,
): Script | undefined {
	for (const quoted of word.quoted) {
		if (!quoted.closed || quoted.quote === "`" || !quoted.simple) continue;
		if (quoted.end !== word.end) continue;
		const code = command.slice(quoted.contentStart, quoted.contentEnd);
		if (!code) continue;
		const prefix = scriptPrefix(command, commandWord, quoted.start);
		if (prefix === undefined) continue;
		if (isInlineScript(name, language, prefix))
			return {
				start: quoted.contentStart,
				end: quoted.contentEnd,
				language,
			};
	}
	return shellScriptWord(command, word, commandWord, name, language);
}

function shellScriptWord(
	command: string,
	word: ShellWord,
	commandWord: EffectiveCommand,
	name: string,
	language: string,
): Script | undefined {
	const bounds = shellScriptBounds(command, word);
	if (!bounds) return undefined;
	const prefix = scriptPrefix(command, commandWord, word.start);
	if (prefix === undefined || !isInlineScript(name, language, prefix)) return undefined;
	return { ...bounds, language, value: word.value, quote: "shell" };
}

function shellScriptBounds(
	command: string,
	word: ShellWord,
): { start: number; end: number } | undefined {
	const quoted = word.quoted;
	if (quoted.length < 2) return undefined;
	const first = quoted[0]!;
	const last = quoted.at(-1)!;
	if (word.start !== first.start || word.end !== last.end) return undefined;
	for (const [index, segment] of quoted.entries()) {
		if (segment.quote !== "'" || !segment.closed) return undefined;
		if (index > 0 && command.slice(quoted[index - 1]!.end, segment.start) !== "\\'")
			return undefined;
	}
	return { start: first.contentStart, end: last.contentEnd };
}

function scriptPrefix(
	command: string,
	commandWord: EffectiveCommand,
	start: number,
): string | undefined {
	const prefix = command.slice(commandWord.word.end, start).replace(/\\\r?\n/g, " ");
	return /\n|(?:^|\s)--(?:\s|$)/.test(prefix) ? undefined : prefix;
}

function isInlineScript(name: string, language: string, prefix: string): boolean {
	if (language === "python") return /^\s+(?:-[A-Za-z]+\s+)*-c\s*$/.test(prefix);
	if (name === "playwright-cli") return /^\s+(?:-s=\S+\s+)?run-code\s+$/.test(prefix);
	if (name === "deno") return /^\s+eval(?:\s+--[\w=-]+)*\s+$/.test(prefix);
	if (name === "node" || name === "bun")
		return /^\s+(?:--[\w-]+(?:=[^\s'"]+)?\s+)*(?:-[ep]|--(?:eval|print)=?)\s*$/.test(
			prefix,
		);
	if (["ruby", "perl", "lua"].includes(name))
		return /^\s+(?:-[A-Za-z]+\s+)*-[np]*e\s*$/.test(prefix);
	return false;
}

function inlineLanguage(name: string): string | undefined {
	if (/^python(?:\d+(?:\.\d+)*)?$/.test(name)) return "python";
	if (name === "bun" || name === "deno") return "typescript";
	if (name === "node" || name === "playwright-cli") return "javascript";
	if (["ruby", "perl", "lua"].includes(name)) return name;
	return undefined;
}

function displayBreaks(
	command: string,
	tokens: ThemedToken[][],
	bodyRanges: ReturnType<typeof scanShell>["bodyRanges"],
): number[] {
	const breaks: number[] = [];
	if (command.length <= 90) return breaks;
	for (const line of tokens) {
		if (line.length === 0 || isInRanges(line[0]!.offset, bodyRanges)) continue;
		if (
			line.some(
				(token) =>
					!token.type &&
					(token.content.trim() === "<<" || token.content.trim() === "<<-"),
			)
		)
			continue;
		for (const token of line) {
			if (token.type) continue;
			const value = token.content.trim();
			if (!breakOperators.has(value)) continue;
			breaks.push(token.offset + token.content.indexOf(value) + value.length);
		}
	}
	return breaks.filter((offset) => !/^[ \t]*(?:\r?\n|$)/.test(command.slice(offset)));
}

function isAssignment(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(value);
}

function basename(path: string): string {
	return path.split("/").at(-1) ?? path;
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
