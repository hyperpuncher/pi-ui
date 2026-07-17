import { assertEquals } from "@std/assert";

import { PromptHistoryNavigator } from "./prompt-history.js";

Deno.test("prompt history browses newest first and restores the empty draft", () => {
	const history = new PromptHistoryNavigator();
	history.sync(["third", "second", "first"]);

	assertEquals(history.navigate("", "up"), { value: "third", cursor: "start" });
	assertEquals(history.navigate("third", "up"), {
		value: "second",
		cursor: "start",
	});
	assertEquals(history.navigate("second", "up"), {
		value: "first",
		cursor: "start",
	});
	assertEquals(history.navigate("first", "up"), {
		value: "first",
		cursor: "start",
	});
	assertEquals(history.navigate("first", "down"), {
		value: "second",
		cursor: "end",
	});
	assertEquals(history.navigate("second", "down"), {
		value: "third",
		cursor: "end",
	});
	assertEquals(history.navigate("third", "down"), { value: "", cursor: "end" });
});

Deno.test("prompt history only starts from an empty prompt", () => {
	const history = new PromptHistoryNavigator();
	history.sync(["previous"]);

	assertEquals(history.navigate("draft", "up"), undefined);
	assertEquals(history.navigate("", "down"), undefined);
	assertEquals(history.navigate("", "up"), { value: "previous", cursor: "start" });
});

Deno.test("prompt history resets when the session history changes", () => {
	const history = new PromptHistoryNavigator();
	history.sync(["session one"]);
	assertEquals(history.navigate("", "up")?.value, "session one");

	history.sync(["session two"]);
	assertEquals(history.navigate("", "up")?.value, "session two");
});
