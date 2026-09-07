import { beforeAll, expect, test } from "bun:test";

import { getHighlighterIfLoaded, type ThemedToken } from "@pierre/diffs";

import { getPierreThemes } from "../pierre-theme.ts";
import { highlightBash, loadBashLanguages } from "./bash-highlight.ts";
import { loadPierreLanguage } from "./diffs.ts";
import { renderMessage } from "./messages.tsx";

beforeAll(async () => {
	expect(await loadPierreLanguage("bash")).toBe(true);
});

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
	expect(
		result.tokens
			.flat()
			.map((token) => token.content)
			.join(""),
	).toBe(command);
});

test("dual themes retain scopes and each theme's token types", () => {
	const highlighter = getHighlighterIfLoaded()!;
	const options = { lang: "bash", themes: getPierreThemes() };
	const code = 'echo "hello" # comment';
	for (const includeExplanation of [true, "scopeName"] as const) {
		const tokens = highlighter.codeToTokens(code, {
			...options,
			includeExplanation,
		}).tokens;
		expect(styles(tokens)).toEqual(styles(native(code, "bash")));
		expect(
			tokens
				.flat()
				.some((token) =>
					token.explanation?.some((part) =>
						part.scopes.some((scope) => scope.scopeName.includes("comment")),
					),
				),
		).toBe(true);
	}
	const tokens = highlighter.codeToTokensWithThemes(code, {
		...options,
		includeExplanation: "tokenType",
	});
	for (const token of tokens.flat()) {
		for (const variant of Object.values(token.variants)) {
			expect(variant).toHaveProperty("type");
		}
	}
});

test("loads only encountered languages and refreshes running and restored tool titles", async () => {
	// A separate process gives this test a genuinely cold shared highlighter.
	const child = Bun.spawn(
		[
			process.execPath,
			"--eval",
			`
		import assert from "node:assert/strict";
		import { getHighlighterIfLoaded } from "@pierre/diffs";
		import { loadPierreLanguage } from "./src/ui/diffs.ts";
		import { loadBashLanguages, highlightBash } from "./src/ui/bash-highlight.ts";
		import { getPierreThemes, setActiveCodeTheme } from "./src/pierre-theme.ts";
		import { MessageRenderService } from "./src/ui/message-render-service.ts";
		import { renderMessage } from "./src/ui/messages.tsx";
		import { AppStore } from "./src/state/app-store.ts";

		await loadPierreLanguage("bash");
		const highlighter = getHighlighterIfLoaded();
		const languages = () => new Set(highlighter.getLoadedLanguages().map(name => highlighter.getLanguage(name).name));
		assert.deepEqual([...languages()], ["shellscript"]);
		// Count actual calls without replacing the real tokenizer's behavior.
		let shellTokenizations = 0;
		let pythonTokenizations = 0;
		const codeToTokens = highlighter.codeToTokens.bind(highlighter);
		highlighter.codeToTokens = (code, options) => {
			if (options.lang === "bash") shellTokenizations++;
			if (options.lang === "python") pythonTokenizations++;
			return codeToTokens(code, options);
		};
		const plain = {
			id: "plain-perf", role: "tool", state: "success", text: "", timestamp: new Date(0),
			presentationState: "final", presentationVersion: 1,
			titleParts: [{ highlight: "bash", text: "echo " + "x".repeat(100) + "; echo done" }],
		};
		const plainHtml = renderMessage(plain);
		assert.equal(shellTokenizations, 1, "formatting and highlighting should share one shell pass");
		await loadPierreLanguage("json");
		assert.equal(renderMessage(plain), plainHtml);
		assert.equal(shellTokenizations, 1, "an unrelated grammar must not invalidate cached commands");
		for (const [state, language, command] of [
			["running", "python", "python -c 'print(42)'"],
			["success", "sql", "psql <<SQL\\nSELECT 42;\\nSQL"],
		]) {
			const store = new AppStore();
			store.transcript.replaceMessages([{
				role: "tool", state, format: "output", text: "output <ready>", timestamp: new Date(0),
				titleParts: [{ highlight: "bash", mono: true, text: command }],
			}]);
			const patch = Promise.withResolvers();
			const renderer = new MessageRenderService(store, html => patch.resolve(html), () => {});
			const id = store.messages[0].id;
			const initial = renderer.renderMessageElement(id);
			const before = languages();
			assert(!before.has(language));
			if (state === "running") renderer.messageAppended(id);
			else renderer.enqueueEnhancement(id);
			const enhanced = await patch.promise;
			assert.notEqual(enhanced, initial);
			assert(enhanced.includes("&lt;ready&gt;"));
			assert.deepEqual([...languages()].filter(name => !before.has(name)), [language]);
			await loadBashLanguages(command);
			assert.deepEqual(languages(), new Set([...before, language]));
		}
		const pythonBefore = pythonTokenizations;
		const script = "print(12345)";
		const variants = ["python -c '" + script + "'", "env python -c '" + script + "' > result.txt", "python - <<PY\\n" + script + "\\nPY"];
		for (const command of variants) {
			const { tokens } = highlightBash(command);
			assert.equal(tokens.map(line => line.map(t => t.content).join("")).join("\\n"), command);
			for (const token of tokens.flat()) assert.equal(command.slice(token.offset, token.offset + token.content.length), token.content);
		}
		assert.equal(pythonTokenizations, pythonBefore + 1, "the same script should be tokenized once across different wrappers");
		const themes = getPierreThemes();
		const original = highlightBash(variants[0]);
		setActiveCodeTheme({ light: themes.dark, dark: themes.light });
		const swapped = highlightBash(variants[0]);
		assert.notDeepEqual(swapped.tokens, original.tokens);
		assert.equal(pythonTokenizations, pythonBefore + 2, "a different theme needs different tokens");
		setActiveCodeTheme(themes);
		highlightBash(variants[0]);
		assert.equal(pythonTokenizations, pythonBefore + 2);
		highlightBash("python -c 'print(54321)'");
		assert.equal(pythonTokenizations, pythonBefore + 3, "a different script body must not reuse old tokens");
		const before = languages();
		await loadBashLanguages("cat <<EOF\\nunknown data\\nEOF");
		assert.deepEqual(languages(), before);
	`,
		],
		{ cwd: `${import.meta.dir}/../..`, stdout: "pipe", stderr: "pipe" },
	);
	const error = await new Response(child.stderr).text();
	expect({ exitCode: await child.exited, error }).toEqual({ exitCode: 0, error: "" });
});

test.each([
	["python3 - <<'EOF'", "python", "from pathlib import Path\nprint(Path('x'))"],
	["cd /tmp && uv run --with regex python - <<'EOF'", "python", "print(42)"],
	["/tmp/venv/bin/python3.12 - <<'EOF' > result.json", "python", "print(42)"],
	["node --input-type=module - <<'EOF'", "javascript", "const n = 42"],
	["bun - <<'EOF'", "typescript", "const n: number = 42;"],
	["cat <<'EOF' | node", "javascript", "const n = 42;"],
	["psql \"$DATABASE_URL\" <<'EOF'", "sql", "SELECT * FROM users;"],
	["lua <<EOF", "lua", "local n = 42"],
	["cat > '/tmp/my file.ts' <<'EOF'", "typescript", "const n: number = 42;"],
	["cat <<'EOF' > x.rs", "rust", 'fn main() { println!("hi"); }'],
	["sudo tee -a config.yaml <<'EOF'", "yaml", "enabled: true"],
	["cat >> test.sh <<'EOF'", "bash", 'echo "hello"'],
	["cat > .zshrc <<'EOF'", "bash", "export FOO=bar"],
	["cat > x.html <<'EOF'", "html", "<p>hello</p>"],
	["cat > x.css <<'EOF'", "css", "p { color: red; }"],
	["cat > x.svg <<'EOF'", "xml", "<svg><path /></svg>"],
	["cat > ~/.config/fontconfig/fonts.conf <<'EOF'", "xml", "<fontconfig />"],
	["cat > x.tsx <<'EOF'", "tsx", "const x = <div />;"],
	["cat > x.svelte <<'EOF'", "svelte", "<p>{name}</p>"],
	["cat > x.astro <<'EOF'", "astro", "<p>{name}</p>"],
	["cat > x.jsonc <<'EOF'", "jsonc", '// comment\n{"n": 42}'],
	["cat > x.toml <<'EOF'", "toml", "enabled = true"],
	["cat > x.go <<'EOF'", "go", "package main"],
	["cat > x.md <<'EOF'", "markdown", "# hello"],
	["cat > x.typ <<'EOF'", "typst", "#set text(size: 12pt)"],
	["git apply <<'PATCH'", "diff", "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new"],
	["cat <<'PYEOF'", "python", "print(42)"],
	["cat > x.ts <<'RUSTEOF'", "typescript", "const n: number = 42;"],
	["python - <<'SQL'", "python", "print(42)"],
])("highlights %s as %s", async (header, language, body) => {
	const marker = header.match(/<<\s*'?(\w+)/)![1]!;
	const command = `${header}\n${body}\n${marker}\necho done`;
	await loadBashLanguages(command);
	const { tokens: highlighted } = highlightBash(command)!;
	expect(styles(highlighted.slice(1, -2))).toEqual(styles(native(body, language)));
	expect(styles([highlighted[0]!, ...highlighted.slice(-2)])).toEqual(
		styles([native(command, "bash")[0]!, ...native(command, "bash").slice(-2)]),
	);
	expect(
		highlighted.map((line) => line.map((token) => token.content).join("")).join("\n"),
	).toBe(command);
});

test.each([
	["bun -e '", "typescript", "const n: number = 42", "'"],
	["node --input-type=module -e '", "javascript", "console.log(42)", "'"],
	['node --eval="', "javascript", "console.log(42)", '"'],
	["node -p '", "javascript", "1 + 2", "'"],
	["bun --print '", "typescript", "1 + 2", "'"],
	["deno eval --ext=ts '", "typescript", "const n: number = 42", "'"],
	[
		"uv run --with regex python -c '",
		"python",
		'import re\nprint(re.escape("hi"))',
		"'",
	],
	["/tmp/venv/bin/python3.12 -I -c '", "python", "print(42)", "' argument"],
	["ruby -e '", "ruby", "puts 42", "'"],
	["perl -ne '", "perl", "print $_", "' input.txt"],
	["lua -e '", "lua", "local n = 42", "'"],
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
	for (const token of tokens.flat())
		expect(command.slice(token.offset, token.offset + token.content.length)).toBe(
			token.content,
		);
});

test.each([
	`echo "bun -e 'print(42)'"`,
	`bun -e "console.log('$HOME')"`,
	'bun -e "console.log(\\"hello\\")"',
	"bun -e 'console.log(42)'suffix",
	"bun -e 'console.log(42)'\"suffix\"",
	"bun -e $'console.log(42)'",
	"bun -e 'console.log(42)",
	"bun run script.ts -e 'not a script'",
	"python script.py -c 'not a script'",
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

function formatBashDisplay(command: string): string {
	return highlightBash(command, { format: true })!
		.tokens.map((line) => line.map((token) => token.content).join(""))
		.join("\n");
}

test("formats shell operators without touching embedded scripts or existing newlines", () => {
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
	"echo 'python' <<EOF\nnot python\nEOF",
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
