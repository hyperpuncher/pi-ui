import { assertEquals, assertStringIncludes } from "@std/assert";

import { datastarStream } from "./datastar.ts";

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
