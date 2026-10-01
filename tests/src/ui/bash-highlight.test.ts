import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";

import { getHighlighterIfLoaded, type ThemedToken } from "@pierre/diffs";

import { getPierreThemes } from "#src/pierre-theme.ts";
import {
	codeSnippets,
	highlightBash,
	highlightCodemode,
	loadBashLanguages,
} from "#src/ui/bash-highlight.ts";
import { loadPierreLanguage } from "#src/ui/diffs.ts";
import { renderMessage } from "#src/ui/messages.tsx";

let tokenization: ReturnType<typeof spyOn>;
beforeAll(async () => {
	expect(await loadPierreLanguage("bash")).toBe(true);
	expect(await loadPierreLanguage("javascript")).toBe(true);
	const highlighter = getHighlighterIfLoaded()!;
	const tokenize = highlighter.codeToTokens.bind(highlighter);
	// Exact-color tests must not depend on Shiki's wall-clock budget.
	tokenization = spyOn(highlighter, "codeToTokens").mockImplementation(
		(code, options) => tokenize(code, { ...options, tokenizeTimeLimit: 0 }),
	);
});
afterAll(() => tokenization?.mockRestore());

function styles(tokens: ThemedToken[][]) {
	return tokens.map((line) =>
		line.map(({ content, htmlStyle, color, fontStyle }) => ({
			content,
			htmlStyle,
			color,
			fontStyle,
		})),
	);
}

function native(code: string, lang: string) {
	return getHighlighterIfLoaded()!.codeToTokens(code, {
		lang,
		themes: getPierreThemes(),
	}).tokens;
}

test.each([
	{ command: `rg --line-number '${"highlight".repeat(15)}' src/ui`, format: true },
	{ command: `printf '${"quoted | text; ".repeat(10)}'`, format: true },
	{ command: `echo ${"x".repeat(100)}; echo done`, format: false },
])("preserves long commands without display breaks: $command", ({ command, format }) => {
	const result = highlightBash(command, { format })!;
	expect(styles(result.tokens)).toEqual(styles(native(command, "bash")));
});

test.each([
	["python3 - <<'EOF'", "python", "from pathlib import Path\nprint(Path('x'))"],
	["/tmp/venv/bin/python3.12 - <<'EOF' > result.json", "python", "print(42)"],
	["node --input-type=module - <<'EOF'", "javascript", "const n = 42"],
	["bun - <<'EOF'", "typescript", "const n: number = 42;"],
	["cat <<'EOF' | node", "javascript", "const n = 42;"],
	["psql \"$DATABASE_URL\" <<'EOF'", "sql", "SELECT * FROM users;"],
	["cat > '/tmp/my file.ts' <<'EOF'", "typescript", "const n: number = 42;"],
	["cat <<'EOF' > x.rs", "rust", 'fn main() { println!("hi"); }'],
	["sudo tee -a config.yaml <<'EOF'", "yaml", "enabled: true"],
	["cat >> test.sh <<'EOF'", "bash", 'echo "hello"'],
	["cat > .zshrc <<'EOF'", "bash", "export FOO=bar"],
	["git apply <<'PATCH'", "diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new"],
	["python - <<'SQL'", "python", "print(42)"],
])("highlights %s as %s", async (header, language, body) => {
	const marker = header.match(/<<\s*'?(\w+)/)![1]!;
	const command = `${header}\n${body}\n${marker}\necho done`;
	await loadBashLanguages(command);
	const { tokens: highlighted } = highlightBash(command)!;
	expect(styles(highlighted.slice(1, -2))).toEqual(styles(native(body, language)));
	const shell = native(command, "bash");
	expect(styles([highlighted[0]!, ...highlighted.slice(-2)])).toEqual(
		styles([shell[0]!, ...shell.slice(-2)]),
	);
});

test.each([
	["bun -e '", "typescript", "const n: number = 42", "'"],
	['node --eval="', "javascript", "console.log(42)", '"'],
	["node -p '", "javascript", "1 + 2", "'"],
	[
		"playwright-cli run-code '",
		"javascript",
		"async page => { return page.title(); }",
		"'",
	],
	[
		"playwright-cli -s=browser run-code '",
		"javascript",
		"async page => { return 42; }",
		"'",
	],
	["bun --print '", "typescript", "1 + 2", "'"],
	["deno eval --ext=ts '", "typescript", "const n: number = 42", "'"],
	[
		"uv run --with regex python -c '",
		"python",
		'import re\nprint(re.escape("hi"))',
		"'",
	],
	["perl -ne '", "perl", "print $_", "' input.txt"],
	["awk -F: '", "awk", "{print $1}", "' input.txt"],
])("highlights literal inline scripts: %s", async (prefix, language, body, suffix) => {
	const command = prefix + body + suffix;
	await loadBashLanguages(command);
	const { tokens } = highlightBash(command)!;
	const embedded = tokens
		.flat()
		.filter(
			(token) =>
				token.offset >= prefix.length &&
				token.offset < prefix.length + body.length,
		);
	expect(styles([embedded])).toEqual(styles([native(body, language).flat()]));
	expect(
		tokens.map((line) => line.map((token) => token.content).join("")).join("\n"),
	).toBe(command);
});

test.each([
	`echo "bun -e 'print(42)'"`,
	`bun -e "console.log('$HOME')"`,
	'bun -e "console.log(\\"hello\\")"',
	"bun -e 'console.log(42)'suffix",
	"bun -e $'console.log(42)'",
	"bun -e 'console.log(42)",
	"bun run script.ts -e 'not a script'",
	"node -- -e 'not a script'",
	"awk -v 'name=value' '{print name}'",
	"awk -f 'script.awk' input.txt",
	"jq --arg name 'value' '.name'",
])("leaves nonliteral or ambiguous inline arguments unchanged: %s", async (command) => {
	await loadBashLanguages(command);
	expect(styles(highlightBash(command)!.tokens)).toEqual(
		styles(native(command, "bash")),
	);
});

test("highlights multiple inline scripts without changing surrounding commands", async () => {
	const command = "node -e 'console.log(1)' && python -c 'print(2)'";
	await loadBashLanguages(command);
	const tokens = highlightBash(command)!.tokens.flat();
	for (const [body, language] of [
		["console.log(1)", "javascript"],
		["print(2)", "python"],
	] as const) {
		const start = command.indexOf(body);
		const embedded = tokens.filter(
			(token) => token.offset >= start && token.offset < start + body.length,
		);
		expect(styles([embedded])).toEqual(styles([native(body, language).flat()]));
	}
	expect(tokens.map((token) => token.content).join("")).toBe(command);
});

test.each([
	["bash", "command", '"', "echo hello; pwd", "bash"],
	[
		"mcp__playwright__browser_run_code",
		"code",
		"'",
		"const n = 42; text(n);",
		"javascript",
	],
	["bash", "command", "`", "echo hello\npwd", "bash"],
])(
	"highlights literal codemode tools.%s %s strings",
	(tool, field, quote, body, language) => {
		const prefix = "text(await tools." + tool + "({" + field + ":" + quote;
		const code = prefix + body + quote + "}));";
		const result = highlightCodemode(code)!;
		expect(
			result.tokens
				.map((line) => line.map((token) => token.content).join(""))
				.join("\n"),
		).toBe(code);
		const embedded = result.tokens
			.flat()
			.filter(
				(token) =>
					token.offset >= prefix.length &&
					token.offset < prefix.length + body.length,
			);
		expect(styles([embedded])).toEqual(styles([native(body, language).flat()]));
	},
);

test.each([
	[
		"file_patch",
		{
			path: "sample.ts",
			edits: [{ newText: 'const n = 42;\nconst s = "<script>☃😀";' }],
		},
		'"',
		"typescript",
	],
	[
		"file_replace",
		{ path: "sample.ts", edits: [{ oldText: 'const s = "a";\n' }] },
		"'",
		"typescript",
	],
	[
		"file_create",
		{ path: "sample.py", content: "def answer():\n    return 42\n" },
		'"',
		"python",
	],
	["query_runner", { language: "sql", code: "SELECT 42;" }, '"', "sql"],
	[
		"file_create",
		{ path: "sample.py", content: 'def label(value):\n    return f"${value}"\n' },
		"template",
		"python",
	],
	[
		"file_create",
		{
			path: "sample.ts",
			content: 'const text = "line\\n"; const label = `n:${42}`;',
		},
		"template",
		"typescript",
	],
	[
		"file_patch",
		{ path: "sample.ts", edits: [{ newText: String.raw`const pattern = /\w+/;` }] },
		"raw",
		"typescript",
	],
])(
	"uses parsed %s arguments to highlight code without changing source",
	async (name, args, quote, language) => {
		await loadPierreLanguage(language);
		const snippets = codeSnippets({
			calls: [{ id: "child", name, arguments: args, status: "ok" }],
			complete: true,
		});
		expect(snippets.length).toBe(1);
		const snippet = snippets[0]!;
		const encoded = JSON.stringify(snippet.value).slice(1, -1);
		const literal =
			quote === '"'
				? '"' + encoded + '"'
				: quote === "'"
					? "'" + encoded.replaceAll('\\"', '"').replaceAll("'", "\\'") + "'"
					: quote === "template"
						? "`" +
							snippet.value
								.replaceAll("\\", "\\\\")
								.replaceAll("`", "\\`")
								.replaceAll("${", "\\${") +
							"`"
						: "String.raw" + "`" + snippet.value + "`";
		const code = "tools." + name + "({" + snippet.field + ":" + literal + "})";
		const result = highlightCodemode(code, snippets)!;
		expect(
			result.tokens
				.map((line) => line.map((token) => token.content).join(""))
				.join("\n"),
		).toBe(code);
		const keyword = native(snippet.value, language)
			.flat()
			.find((token) => /^(const|def|SELECT)$/.test(token.content))!;
		const embedded = result.tokens
			.flat()
			.find((token) => token.content === keyword.content)!;
		expect(embedded.htmlStyle).toEqual(keyword.htmlStyle);
		expect(result.missingLanguages).toEqual([]);
	},
);

test("highlights large saved file payloads without losing escapes or blank lines", async () => {
	await loadPierreLanguage("typescript");
	const value = "const n = 42;\n\n".repeat(700);
	const nested = {
		calls: [
			{
				id: "large",
				name: "write",
				arguments: { path: "large.ts", content: value },
				status: "ok" as const,
			},
		],
		complete: true,
	};
	const code = "tools.write(" + JSON.stringify(nested.calls[0]!.arguments) + ")";
	const result = highlightCodemode(code, codeSnippets(nested))!;
	expect(
		result.tokens
			.map((line) => line.map((token) => token.content).join(""))
			.join("\n"),
	).toBe(code);
	expect(result.tokens.flat().some((token) => token.content === "const")).toBe(true);
});

test.each([
	'// newText:"const n = 42;"',
	"text('newText:\"const n = 42;\"')",
	'const documentation = `newText:"const n = 42;"`;',
	"tools.edit({newText:`${value}`})",
])(
	"does not treat comments, documentation, or interpolation as a payload: %s",
	(code) => {
		expect(
			styles(
				highlightCodemode(code, [
					{ field: "newText", value: "const n = 42;", language: "typescript" },
				])!.tokens,
			),
		).toEqual(styles(native(code, "javascript")));
	},
);

test("codemode highlights javascript inside a literal bash playwright call", () => {
	const body = "async page => { const n = 42; return n; }";
	const code =
		'tools.bash({command:"playwright-cli run-code ' + "'" + body + "'" + '"})';
	const start = code.indexOf(body);
	const tokens = highlightCodemode(code)!
		.tokens.flat()
		.filter((token) => token.offset >= start && token.offset < start + body.length);
	expect(styles([tokens])).toEqual(styles([native(body, "javascript").flat()]));
});

test.each([
	'// tools.bash({command:"echo hi"})',
	'text("tools.bash({command:hello})")',
	String.raw`tools.bash({command:"echo \"hi\""})`,
	"tools.bash({command:`echo ${value}`})",
])("keeps escaped, dynamic, and non-call source intact: %s", (code) => {
	expect(styles(highlightCodemode(code)!.tokens)).toEqual(
		styles(native(code, "javascript")),
	);
});

test("formats shell operators without touching embedded scripts or existing newlines", () => {
	const formatBashDisplay = (command: string) =>
		highlightBash(command, { format: true })!
			.tokens.map((line) => line.map((token) => token.content).join(""))
			.join("\n");
	const javascript =
		"import { read } from 'example';\nconst obj = { value: 1 };\nfor (const x of [1, 2]) { console.log(x); }";
	const python = "data = {'value': 1};\nfor key in data:\n    print(key)";
	const command = `echo ${"x".repeat(90)} && echo ready;\nbun - <<'JS'\n${javascript}\nJS\npython - <<'PY'\n${python}\nPY`;
	expect(formatBashDisplay(command)).toBe(command.replace(" && echo", " &&\necho"));
	const piped = `cat <<'JS' | node\n${javascript}\nJS`;
	expect(formatBashDisplay(piped)).toBe(piped);
	const inline = `bun -e '${"const obj = { value: 1 }; ".repeat(5)}' && echo done`;
	expect(formatBashDisplay(inline)).toBe(inline.replace(" && echo", " &&\necho"));
	const comment = `echo ${"x".repeat(90)} # preserve ; && |`;
	expect(formatBashDisplay(comment)).toBe(comment);
	const compound = `case ${"x".repeat(90)} in x) one ;;& y) two ;& esac`;
	expect(formatBashDisplay(compound)).toBe(
		compound.replace(";;& y", ";;&\ny").replace(";& esac", ";&\nesac"),
	);
	const pipe = `echo ${"x".repeat(90)} |& tee output; echo done`;
	expect(formatBashDisplay(pipe)).toBe(
		pipe.replace(" |& tee", " |&\ntee").replace("; echo", ";\necho"),
	);
});

test("renders embedded scripts as escaped, themed text", async () => {
	await loadBashLanguages("python - <<PY\nprint(42)\nPY");
	const html = renderMessage({
		id: "heredoc",
		presentationState: "final",
		presentationVersion: 1,
		role: "tool",
		state: "success",
		text: "",
		timestamp: new Date(0),
		titleParts: [
			{
				highlight: "bash",
				mono: true,
				text: `python - <<'PY'\nprint('<img src=x onerror=alert(1)>')\nPY`,
			},
		],
	});
	expect(html).not.toContain("<img");
	expect(html).toContain("&lt;img");
	expect(html).toContain("--shiki-dark:");
	expect(html).toContain("--shiki-light:");
});

test("preserves source offsets and blank lines with unicode and CRLF scripts", async () => {
	const body = '\r\nprint("😀")\r\n\r\n';
	for (const command of [`python -c '${body}'`, `python - <<'PY'\r\n${body}\r\nPY`]) {
		await loadBashLanguages(command);
		const { tokens } = highlightBash(command)!;
		expect(
			tokens.map((line) => line.map((token) => token.content).join("")).join("\n"),
		).toBe(command.replaceAll("\r\n", "\n"));
		for (const token of tokens.flat())
			expect(command.slice(token.offset, token.offset + token.content.length)).toBe(
				token.content,
			);
	}
});

test("preserves multiline language state, blank lines, tabs and multiple blocks", async () => {
	const python = '\ttext = """hello\n\n\tworld"""\n\tprint(text)';
	const sql = "SELECT 42;";
	const command = `python - <<-'PY'\n${python}\n\tPY\npsql <<SQL\n${sql}\nSQL`;
	await loadBashLanguages(command);
	const { tokens } = highlightBash(command)!;
	expect(styles(tokens.slice(1, 5))).toEqual(styles(native(python, "python")));
	expect(styles(tokens.slice(7, 8))).toEqual(styles(native(sql, "sql")));
});

test.each([
	"cat <<EOF\nunknown content\nEOF",
	"python --version; cat <<EOF\nnot python\nEOF",
	"python producer.py | cat <<EOF\nnot python\nEOF",
	"echo \"python <<'PY'\nprint(42)\nPY\"",
	"# python <<PY\nprint(42)\nPY",
	"python - <<PY\nprint(42)",
	"python - <<PY\nprint(42)\nPY extra\nprint(43)\nPY",
	"cat <<PY <<SQL\nprint(42)\nPY\nSELECT 42;\nSQL",
	"python <<< 'print(42)'",
])("leaves ambiguous or incomplete input unchanged: %s", (command) => {
	expect(styles(highlightBash(command)!.tokens)).toEqual(
		styles(native(command, "bash")),
	);
});
