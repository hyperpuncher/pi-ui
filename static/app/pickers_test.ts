import { test } from "bun:test";

import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

import { assertEquals, waitForCondition } from "#testing/assertions";

import { endpoints } from "../../src/server/routes/endpoints.ts";
import {
	completeFileValue,
	copyLastAssistantMessage,
	extractArgumentQuery,
	extractFilePrefix,
	nextPickerIndex,
} from "./pickers.js";

test("extractArgumentQuery reads the command name and trailing argument text", () => {
	assertEquals(extractArgumentQuery("/model op", 9), {
		command: "model",
		prefix: "op",
	});
	assertEquals(extractArgumentQuery("/Thinking ", 10), {
		command: "thinking",
		prefix: "",
	});
	assertEquals(extractArgumentQuery("/export /tmp/out.html", 21), {
		command: "export",
		prefix: "/tmp/out.html",
	});
});

test("extractArgumentQuery matches only up to the caret, not the whole line", () => {
	assertEquals(extractArgumentQuery("/model opus and more", 11), {
		command: "model",
		prefix: "opus",
	});
});

test("extractArgumentQuery returns undefined before the command name has a trailing space", () => {
	assertEquals(extractArgumentQuery("/model", 6), undefined);
	assertEquals(extractArgumentQuery("plain text", 10), undefined);
	assertEquals(extractArgumentQuery("", 0), undefined);
});

test("extractFilePrefix finds the @ token at the caret", () => {
	assertEquals(extractFilePrefix("open @src/ui after", 12), {
		start: 5,
		end: 12,
		query: "src/ui",
	});
	assertEquals(extractFilePrefix("plain text", 10), undefined);
	assertEquals(extractFilePrefix("x=@src", 6), {
		start: 2,
		end: 6,
		query: "src",
	});
});

test("quoted file completions follow pi's spacing and cursor behavior", () => {
	const provider = new CombinedAutocompleteProvider([], "/workspace");
	for (const { before, after, value, label } of [
		{ before: "see @sp", after: "", value: '@"space dir/"', label: "space dir/" },
		{
			before: 'see @"space dir/sp',
			after: '" after',
			value: '@"space dir/space file.txt"',
			label: "space file.txt",
		},
		{
			before: 'see @"space dir/ne',
			after: '"',
			value: '@"space dir/nested dir/"',
			label: "nested dir/",
		},
	]) {
		const input = before + after;
		const match = extractFilePrefix(input, before.length);
		if (!match) throw new Error("Missing quoted file prefix");
		const expected = provider.applyCompletion(
			[input],
			0,
			before.length,
			{ value, label },
			`@${match.query}`,
		);
		const actual = completeFileValue(input, match, value);
		assertEquals(actual, { text: expected.lines[0], cursor: expected.cursorCol });
		if (label.endsWith("/")) {
			assertEquals(
				extractFilePrefix(actual.text, actual.cursor)?.query,
				value.slice(1, -1),
			);
		}
	}
});

test("picker navigation stops at both visual boundaries", () => {
	assertEquals(nextPickerIndex(4, -1, -1), 0);
	assertEquals(nextPickerIndex(4, 0, 1), 0);
	assertEquals(nextPickerIndex(4, 3, -1), 3);
	assertEquals(nextPickerIndex(4, 0, -1), 1);
	assertEquals(nextPickerIndex(4, 1, -1), 2);
	assertEquals(nextPickerIndex(4, 1, 1), 0);
});

test("file completion preserves surrounding prompt text and directory flow", () => {
	const match = { start: 4, end: 7, query: "sr" };
	assertEquals(completeFileValue("see @sr now", match, "@src/app.ts"), {
		text: "see @src/app.ts  now",
		cursor: 16,
	});
	assertEquals(completeFileValue("see @sr", match, "@src/"), {
		text: "see @src/",
		cursor: 9,
	});
});

/** Patches a global via `Object.defineProperty` (see terminal-keys_test.ts's `patchGlobal`). */
function patchGlobal(name: string, value: unknown): () => void {
	return patchProperty(globalThis, name, value);
}

function patchProperty(
	target: typeof globalThis | Navigator,
	name: string,
	value: unknown,
): () => void {
	const original = Object.getOwnPropertyDescriptor(target, name);
	Object.defineProperty(target, name, { configurable: true, writable: true, value });
	return () => {
		if (original) Object.defineProperty(target, name, original);
		else Reflect.deleteProperty(target, name);
	};
}

/** Fakes just the DOM `copyLastAssistantMessage()` touches (O3). */
function installCopyDom(options: {
	replyText?: string;
	clipboard?: { writeText(text: string): Promise<void> };
	execCommandResult: boolean;
}) {
	const posts: unknown[] = [];
	const execCalls: string[] = [];
	const textarea = {
		value: "",
		style: {},
		setAttribute() {},
		focus() {},
		select() {},
		setSelectionRange() {},
		remove() {},
	};
	const fakeDocument = {
		querySelectorAll: () =>
			options.replyText === undefined ? [] : [{ textContent: options.replyText }],
		createElement: () => textarea,
		body: { append() {} },
		execCommand: (command: string) => {
			execCalls.push(command);
			return options.execCommandResult;
		},
	};
	const restores = [
		patchGlobal("document", fakeDocument),
		patchProperty(globalThis.navigator, "clipboard", options.clipboard),
		patchGlobal("fetch", async (url: string, init: RequestInit) => {
			posts.push({ url, body: JSON.parse(String(init.body)) });
			return new Response(null, { status: 204 });
		}),
	];
	return {
		posts,
		execCalls,
		restore: () => {
			for (const restore of restores.reverse()) restore();
		},
	};
}

test("/copy falls through to the server when there is no reply to copy", () => {
	const dom = installCopyDom({ execCommandResult: true });
	try {
		assertEquals(copyLastAssistantMessage(), false);
		assertEquals(dom.posts, []);
	} finally {
		dom.restore();
	}
});

test("/copy uses the execCommand fallback when the Clipboard API is missing", () => {
	const dom = installCopyDom({ replyText: "reply", execCommandResult: true });
	try {
		assertEquals(copyLastAssistantMessage(), true);
		assertEquals(dom.execCalls, ["copy"]);
		assertEquals(dom.posts, []);
	} finally {
		dom.restore();
	}
});

test("/copy reports a visible failure when writeText rejects and the fallback fails", async () => {
	const dom = installCopyDom({
		replyText: "reply",
		clipboard: { writeText: () => Promise.reject(new Error("denied")) },
		execCommandResult: false,
	});
	try {
		assertEquals(copyLastAssistantMessage(), true);
		await waitForCondition(() => dom.posts.length > 0);
		assertEquals(dom.execCalls, ["copy"]);
		assertEquals(dom.posts, [
			{ url: endpoints.prompt, body: { prompt: "/copy unavailable" } },
		]);
	} finally {
		dom.restore();
	}
});
