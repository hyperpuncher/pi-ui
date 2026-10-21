import assert from "node:assert/strict";

import { getHighlighterIfLoaded } from "@pierre/diffs";

import { activeCodeThemes, setCodeThemes } from "#src/pierre-theme.ts";
import { AppStore } from "#src/state/app-store.ts";
import { highlightBash } from "#src/ui/bash-highlight.ts";
import { isPierreLanguageLoaded, loadPierreLanguage } from "#src/ui/diffs.ts";
import { MessageRenderService } from "#src/ui/message-render-service.ts";
import { renderMessage } from "#src/ui/messages.tsx";
import type { AppMessage } from "#src/ui/render-state.ts";

// Run in a child process so this highlighter is cold even under plain `bun test`.
async function verifyColdHighlighter(): Promise<void> {
	await loadPierreLanguage("bash");
	assert(isPierreLanguageLoaded("bash"));
	assert(
		isPierreLanguageLoaded("python"),
		"Highlights bundles every supported language",
	);

	let shellTokenizations = 0;
	let pythonTokenizations = 0;
	const highlighter = getHighlighterIfLoaded()!;
	const tokenize = highlighter.codeToTokens.bind(highlighter);
	highlighter.codeToTokens = (code, options) => {
		if (options.lang === "bash") shellTokenizations++;
		if (options.lang === "python") pythonTokenizations++;
		return tokenize(code, options);
	};

	const plain: AppMessage = {
		id: "plain-perf",
		role: "tool",
		state: "success",
		text: "",
		timestamp: new Date(0),
		presentationState: "final",
		presentationVersion: 1,
		titleParts: [{ highlight: "bash", text: `echo ${"x".repeat(100)}; echo done` }],
	};
	const plainHtml = renderMessage(plain);
	assert.equal(
		shellTokenizations,
		1,
		"formatting and highlighting should share one shell pass",
	);
	await loadPierreLanguage("json");
	assert.equal(renderMessage(plain), plainHtml);
	assert.equal(
		shellTokenizations,
		1,
		"an unrelated language must not invalidate cached commands",
	);

	for (const [state, command] of [
		["running", "python -c 'print(42)'"],
		["success", "psql <<SQL\nSELECT 42;\nSQL"],
	] as const) {
		const store = new AppStore();
		store.transcript.replaceMessages([
			{
				role: "tool",
				state,
				format: "output",
				text: "output <ready>",
				timestamp: new Date(0),
				titleParts: [{ highlight: "bash", mono: true, text: command }],
			},
		]);
		const patch = Promise.withResolvers<string>();
		const renderer = new MessageRenderService(
			store,
			(html) => patch.resolve(html),
			() => {},
		);
		const id = store.messages[0]!.id;
		const initial = renderer.renderMessageElement(id);
		assert(initial?.includes("output &lt;ready&gt;"));
		if (state === "running") renderer.messageAppended(id);
		else renderer.enqueueEnhancement(id);
		const enhanced = await patch.promise;
		assert(enhanced.includes("&lt;ready&gt;"));
		assert(enhanced.includes("color:light-dark("));
	}

	const pythonBefore = pythonTokenizations;
	const script = "print(12345)";
	const variants = [
		`python -c '${script}'`,
		`env python -c '${script}' > result.txt`,
		`python - <<PY\n${script}\nPY`,
	];
	for (const command of variants) highlightBash(command);
	assert.equal(
		pythonTokenizations,
		pythonBefore + 1,
		"the same script should be tokenized once across different wrappers",
	);
	const themes = activeCodeThemes;
	const original = highlightBash(variants[0]!)!;
	setCodeThemes({ light: themes.dark, dark: themes.light });
	const swapped = highlightBash(variants[0]!)!;
	assert.notDeepEqual(swapped.tokens, original.tokens);
	assert.equal(
		pythonTokenizations,
		pythonBefore + 2,
		"a different theme needs different tokens",
	);
	setCodeThemes(themes);
	highlightBash(variants[0]!);
	assert.equal(pythonTokenizations, pythonBefore + 2);
	highlightBash("python -c 'print(54321)'");
	assert.equal(
		pythonTokenizations,
		pythonBefore + 3,
		"a different script body must not reuse old tokens",
	);
}

await verifyColdHighlighter();
