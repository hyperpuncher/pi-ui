import { assertEquals, assertStringIncludes } from "@std/assert";

import { datastarResponse, datastarStream } from "./datastar.ts";

Deno.test("element patches normalize carriage returns into valid SSE data lines", async () => {
	const response = datastarStream((stream) => {
		stream.patchElements('<div id="output">first\rsecond\r\nthird</div>');
	});
	const body = await response.text();

	assertEquals(body.includes("\r"), false);
	assertStringIncludes(body, 'data: elements <div id="output">first\n');
	assertStringIncludes(body, "data: elements second\n");
	assertStringIncludes(body, "data: elements third</div>\n\n");
});

Deno.test("Datastar response preserves ordered events and response metadata", async () => {
	const response = datastarResponse(
		[
			{ type: "elements", elements: '<div id="output">ready</div>' },
			{ type: "signals", signals: { prompt: "done" } },
			{ type: "effect", effect: { type: "focus-prompt" } },
		],
		{ status: 202 },
	);
	const body = await response.text();
	assertEquals(response.status, 202);
	assertStringIncludes(response.headers.get("content-type") ?? "", "text/event-stream");
	const elements = body.indexOf("datastar-patch-elements");
	const signals = body.indexOf("datastar-patch-signals");
	const effect = body.indexOf("prompt-input", signals);
	assertEquals(elements >= 0 && signals > elements && effect > signals, true);
});
