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
import {
	isRecord,
	isString,
	type JsonObject,
	type JsonValue,
} from "#src/utils/type-guards.ts";

// Share script tokens across commands with different wrappers, arguments or redirects.
const scriptCaches = new BoundedCache<string, BoundedCache<string, ThemedToken[]>>(32);
const codemodeCaches = new BoundedCache<string, BoundedCache<string, ThemedToken[][]>>(4);

function scriptCache(language: string): BoundedCache<string, ThemedToken[]> {
	const bucket = `${codeThemeKey()}\0${language}`;
	let cache = scriptCaches.get(bucket);
	if (!cache) {
		cache = new BoundedCache<string, ThemedToken[]>(1024, {
			maxWeight: 8 * 1024 * 1024,
			weight: (key, tokens) => key.length * 2 + tokens.length * 256,
		});
		scriptCaches.set(bucket, cache);
	}
	return cache;
}

function codemodeCache(): BoundedCache<string, ThemedToken[][]> {
	const theme = codeThemeKey();
	let cache = codemodeCaches.get(theme);
	if (!cache) {
		cache = new BoundedCache<string, ThemedToken[][]>(1024, {
			maxWeight: 16 * 1024 * 1024,
			weight: (key, lines) =>
				key.length * 2 + lines.reduce((sum, line) => sum + line.length, 0) * 256,
		});
		codemodeCaches.set(theme, cache);
	}
	return cache;
}

const codemodeFieldPattern =
	/["']?\b(content|oldText|newText|code|script|function|command)["']?\s*:\s*(String\.raw\s*)?$/;
const codemodeCallPattern =
	/\btools\.(bash|\w*browser_run_code)\s*\(\s*\{[^{}]*\b(command|code)\s*:\s*(?:String\.raw\s*)?$/;

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
const maxEmbedDepth = 4;
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

function hasEmbeddedBash(command: string): boolean {
	return /<<|(?:^|\s)(?:-[np]*[epc]\b|--(?:eval|print)\b|eval\b)|(?:^|[\s;|&(/])(?:ssh|(?:ba|z)?sh)(?:\s|$)|\bplaywright-cli\s+(?:-s=\S+\s+)?run-code\b/.test(
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
	const result = highlightBashInternal(command, options.format === true, 0);
	if (!result) return undefined;
	return { tokens: result.lines ?? tokenLines(command, result.flat!, result.breaks) };
}

function highlightBashFlat(command: string, depth: number): ThemedToken[] | undefined {
	const result = highlightBashInternal(command, false, depth);
	if (!result) return undefined;
	return result.flat ?? flattenTokens(result.lines!);
}

function highlightBashInternal(
	command: string,
	formatOption: boolean,
	depth: number,
): { lines?: ThemedToken[][]; flat?: ThemedToken[]; breaks: number[] } | undefined {
	const scan =
		depth < maxEmbedDepth && hasEmbeddedBash(command)
			? scanShell(command)
			: undefined;
	const heredocScripts = scan ? heredocs(scan) : [];
	const inline = scan ? inlineScripts(command, scan) : [];
	const scripts =
		heredocScripts.length && inline.length
			? [...heredocScripts, ...inline]
			: heredocScripts.length
				? heredocScripts
				: inline;
	const tokens =
		heredocScripts.length > 0
			? stubbedBashTokens(command, heredocScripts)
			: bashTokens(command);
	if (!tokens) return undefined;
	const breaks =
		formatOption && command.length > 90
			? displayBreaks(command, tokens, scan?.bodyRanges ?? [])
			: [];
	if (scripts.length === 0 && breaks.length === 0) return { lines: tokens, breaks };
	const flat =
		scripts.length > 0
			? mergeScripts(command, flattenTokens(tokens), scripts, depth)
			: flattenTokens(tokens);
	return { flat, breaks };
}

/** Tokenize outer shell with highlighted heredoc bodies removed, then restore offsets. */
function stubbedBashTokens(
	command: string,
	heredocScripts: Script[],
): ThemedToken[][] | undefined {
	let stub = "";
	let cursor = 0;
	for (const { start, end } of heredocScripts) {
		stub += command.slice(cursor, start);
		cursor = end;
	}
	stub += command.slice(cursor);
	const tokens = bashTokens(stub);
	if (!tokens) return undefined;
	let heredocIndex = 0;
	let delta = 0;
	for (const line of tokens) {
		for (const token of line) {
			while (
				heredocIndex < heredocScripts.length &&
				token.offset + delta >= heredocScripts[heredocIndex]!.start
			) {
				delta +=
					heredocScripts[heredocIndex]!.end -
					heredocScripts[heredocIndex]!.start;
				heredocIndex++;
			}
			if (delta > 0) token.offset += delta;
		}
	}
	return tokens;
}

export function highlightCodemode(code: string, snippets: CodeSnippet[] = []) {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return undefined;
	const baseCache = codemodeCache();
	let baseLines = baseCache.get(code);
	if (!baseLines) {
		baseLines = highlighter.codeToTokens(code, {
			lang: "javascript",
			themes: activeCodeThemes,
			defaultColor: "light-dark()",
		}).tokens;
		baseCache.set(code, baseLines);
	}

	const hints = new Map<string, CodeSnippet | null>();
	for (const snippet of snippets)
		for (const quote of ['"', "'", "`", "template"]) {
			const hintKey = `${snippet.field}\0${quote}\0${encodeLiteral(snippet.value, quote)}`;
			const previous = hints.get(hintKey);
			hints.set(
				hintKey,
				previous === null || (previous && previous.language !== snippet.language)
					? null
					: snippet,
			);
		}
	const hasHints = hints.size > 0;
	if (!hasHints && !code.includes("tools.")) return { tokens: baseLines };
	const scripts: Script[] = [];
	let skipUntil = -1;
	for (const line of baseLines) {
		for (const token of line) {
			if (token.offset <= skipUntil) continue;
			// TextMate's string token type excludes comments and regular expressions.
			if (token.type !== 2) continue;
			const quote = code[token.offset];
			if (quote !== '"' && quote !== "'" && quote !== "`") continue;
			const end = stringEnd(code, token.offset + 1, quote);
			if (end < 0) continue;
			skipUntil = end;
			const prefixEnd = token.offset;
			const lastNonSpace = skipBackwardSpaces(code, prefixEnd - 1);
			const lastChar = lastNonSpace >= 0 ? code[lastNonSpace] : "";
			if (lastChar !== ":" && lastChar !== "w") continue;
			const prefix = code.slice(Math.max(0, prefixEnd - 80), prefixEnd);
			const field = hasHints ? prefix.match(codemodeFieldPattern) : null;
			const call = field ? null : prefix.match(codemodeCallPattern);
			if (!field && !call) continue;
			const body = code.slice(token.offset + 1, end);
			const encoding = quote === "`" && !field?.[2] ? "template" : quote;
			const snippet = field
				? hints.get(`${field[1]}\0${encoding}\0${body}`)
				: undefined;
			const matchedCall =
				call ?? (snippet ? null : prefix.match(codemodeCallPattern));
			const hasEscape = quote !== "`" && body.includes("\\");
			const language =
				snippet?.language ??
				(matchedCall &&
				(matchedCall[1] === "bash"
					? matchedCall[2] === "command"
					: matchedCall[2] === "code") &&
				!hasEscape
					? matchedCall[1] === "bash"
						? "bash"
						: "javascript"
					: undefined);
			if (language && !(quote === "`" && hasInterpolation(body)))
				scripts.push({
					start: token.offset + 1,
					end,
					language,
					value: snippet?.value,
					quote: snippet ? encoding : undefined,
				});
		}
	}
	if (scripts.length === 0) return { tokens: baseLines };
	return {
		tokens: tokenLines(
			code,
			mergeScripts(code, flattenTokens(baseLines), scripts, 0),
			[],
		),
	};
}

/** Tool arguments as YAML, with code in block scalars highlighted by the field's usual language. */
export function highlightArguments(yaml: string) {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return undefined;
	const tokens = highlighter.codeToTokens(yaml, {
		lang: "yaml",
		themes: activeCodeThemes,
		defaultColor: "light-dark()",
	}).tokens;
	const scripts: Script[] = [];
	for (const match of yaml.matchAll(
		/^(code|script|function|command): \|\n((?: {2}.*(?:\n|$))+)/gm,
	)) {
		const body = match[2]!.replace(/\n$/, "");
		const start = match.index + match[0].length - match[2]!.length;
		scripts.push({
			start,
			end: start + body.length,
			language: match[1] === "command" ? "bash" : "javascript",
		});
	}
	if (scripts.length === 0) return { tokens };
	return {
		tokens: tokenLines(
			yaml,
			mergeScripts(yaml, flattenTokens(tokens), scripts, 0),
			[],
		),
	};
}

function skipBackwardSpaces(code: string, offset: number): number {
	while (offset >= 0) {
		const char = code[offset]!;
		if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") break;
		offset--;
	}
	return offset;
}

function hasInterpolation(body: string): boolean {
	let pos = body.indexOf("${");
	while (pos >= 0) {
		if (!isEscaped(body, pos)) return true;
		pos = body.indexOf("${", pos + 2);
	}
	return false;
}

function flattenTokens(lines: ThemedToken[][]): ThemedToken[] {
	const flat: ThemedToken[] = [];
	for (const line of lines) for (const token of line) flat.push(token);
	return flat;
}

function withOffset(
	token: ThemedToken,
	offset: number,
	content = token.content,
): ThemedToken {
	const copy: ThemedToken = { content, offset };
	if (token.htmlStyle !== undefined) copy.htmlStyle = token.htmlStyle;
	if (token.color !== undefined) copy.color = token.color;
	if (token.bgColor !== undefined) copy.bgColor = token.bgColor;
	if (token.fontStyle !== undefined) copy.fontStyle = token.fontStyle;
	if (token.type !== undefined) copy.type = token.type;
	return copy;
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

function mergeScripts(
	command: string,
	source: ThemedToken[],
	scripts: Script[],
	depth: number,
): ThemedToken[] {
	const highlighter = getHighlighterIfLoaded()!;
	if (scripts.length > 1) scripts.sort((a, b) => a.start - b.start);
	const highlighted: ThemedToken[] = [];
	let index = 0;
	let current = source[0];
	for (const { start, end, language, value, quote } of scripts) {
		const code = value ?? command.slice(start, end);
		const cache = scriptCache(language);
		let body = cache.get(code);
		if (!body) {
			try {
				body =
					language === "bash"
						? highlightBashFlat(code, depth + 1)!
						: flattenTokens(
								highlighter.codeToTokens(code, {
									lang: language,
									themes: activeCodeThemes,
									defaultColor: "light-dark()",
								}).tokens,
							);
				cache.set(code, body);
			} catch {
				continue;
			}
		}
		while (current && current.offset + current.content.length <= start) {
			highlighted.push(current);
			current = source[++index];
		}
		const head = current;
		if (head && head.offset < start)
			highlighted.push(
				withOffset(head, head.offset, head.content.slice(0, start - head.offset)),
			);
		if (value !== undefined && quote) {
			let decodedOffset = 0;
			let encodedOffset = start;
			for (const token of body) {
				const gap = encodeLiteral(
					code.slice(decodedOffset, token.offset),
					quote,
					code[token.offset],
				);
				if (gap) highlighted.push(withOffset(head!, encodedOffset, gap));
				encodedOffset += gap.length;
				const content = encodeLiteral(
					token.content,
					quote,
					code[token.offset + token.content.length],
				);
				highlighted.push(withOffset(token, encodedOffset, content));
				encodedOffset += content.length;
				decodedOffset = token.offset + token.content.length;
			}
			if (encodedOffset < end)
				highlighted.push(
					withOffset(head!, encodedOffset, command.slice(encodedOffset, end)),
				);
		} else {
			for (const token of body)
				highlighted.push(withOffset(token, token.offset + start));
		}
		while (current && current.offset + current.content.length <= end)
			current = source[++index];
		if (current && current.offset < end)
			current = withOffset(
				current,
				end,
				current.content.slice(end - current.offset),
			);
	}
	while (current) {
		highlighted.push(current);
		current = source[++index];
	}
	return highlighted;
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
	["ssh", "bash"],
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
	if (name === "ssh") return sshInlineScript(command, segment, commandWord.index);
	const language = inlineLanguage(name);
	if (!language) return undefined;
	for (const word of segment.words.slice(commandWord.index + 1)) {
		if (word.redirectedBy) continue;
		const script = wordScript(command, word, commandWord, name, language);
		if (script) return script;
	}
	return undefined;
}

function sshInlineScript(
	command: string,
	segment: ShellSegment,
	sshIndex: number,
): Script | undefined {
	const word = segment.words
		.slice(sshIndex + 1)
		.findLast((entry) => !entry.redirectedBy);
	if (!word) return undefined;
	const quoted = word.quoted.length === 1 ? word.quoted[0] : undefined;
	if (
		quoted?.closed &&
		quoted.quote === "'" &&
		quoted.simple &&
		quoted.start === word.start &&
		quoted.end === word.end &&
		quoted.contentEnd > quoted.contentStart
	)
		return {
			start: quoted.contentStart,
			end: quoted.contentEnd,
			language: "bash",
		};
	const bounds = shellScriptBounds(command, word);
	return bounds
		? { ...bounds, language: "bash", value: word.value, quote: "shell" }
		: undefined;
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
	if (name === "bash" || name === "sh" || name === "zsh")
		return /^\s+(?:(?:-[A-Za-z]*o\s+\S+|[-+][A-Za-z]+|--[\w-]+)\s+)*-[A-Za-z]*c\s*$/.test(
			prefix,
		);
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
	if (name === "bash" || name === "sh" || name === "zsh") return "bash";
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
	const slash = path.lastIndexOf("/");
	return slash < 0 ? path : path.slice(slash + 1);
}

/** One ordered pass handles both original newlines and display-only breaks. */
function tokenLines(
	command: string,
	tokens: ThemedToken[],
	breaks: number[],
): ThemedToken[][] {
	const lines: ThemedToken[][] = [];
	const length = command.length;
	const tokenCount = tokens.length;
	let tokenIndex = 0;
	let start = 0;
	let newline = command.indexOf("\n");
	let breakIndex = 0;
	const breakCount = breaks.length;

	while (true) {
		let end: number;
		let nextStart: number;
		let done = false;
		if (newline < 0 && breakIndex >= breakCount) {
			end = length;
			nextStart = length;
			done = true;
		} else {
			const nlEnd =
				newline >= 0 && command[newline - 1] === "\r" ? newline - 1 : newline;
			const nextBreak = breakIndex < breakCount ? breaks[breakIndex]! : Infinity;
			if (newline >= 0 && nlEnd <= nextBreak) {
				end = nlEnd;
				nextStart = newline + 1;
				newline = command.indexOf("\n", nextStart);
			} else {
				end = nextBreak;
				let next = nextBreak;
				while (next < length && (command[next] === " " || command[next] === "\t"))
					next++;
				nextStart = next;
				breakIndex++;
			}
		}

		const line: ThemedToken[] = [];
		while (tokenIndex < tokenCount) {
			const token = tokens[tokenIndex]!;
			if (token.offset >= end) break;
			const tokenEnd = token.offset + token.content.length;
			const from = start > token.offset ? start : token.offset;
			const to = end < tokenEnd ? end : tokenEnd;
			if (from < to)
				line.push(
					from === token.offset && to === tokenEnd
						? token
						: withOffset(
								token,
								from,
								token.content.slice(
									from - token.offset,
									to - token.offset,
								),
							),
				);
			if (tokenEnd > end) break;
			tokenIndex++;
		}
		lines.push(line);
		if (done) break;
		start = nextStart;
	}
	return lines;
}
