import { test } from "bun:test";

import { notifySessionDone } from "#src/browser-notifications.ts";
import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import { assertEquals, assertStringIncludes } from "#testing/assertions";

test("session completion sends a browser notification script with escaped details", async () => {
	const hub = new DatastarClientHub();
	const controller = new AbortController();
	const response = hub.createStream(controller.signal, () => ({
		elements: "",
		signals: "{}",
	}));
	notifySessionDone(hub, {
		workspace: 'project "one" </script><script>alert(1)</script>',
		sessionPath: "/sessions/1",
	});
	controller.abort();
	const body = await response.text();
	assertStringIncludes(body, "window.piUi.notifications.show(");
	assertStringIncludes(body, JSON.stringify('project "one"').slice(0, -1));
	assertStringIncludes(body, "\\u003c/script>");
	assertEquals(body.includes("</script><script>alert(1)"), false);
});
