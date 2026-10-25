import { test } from "bun:test";

import { ExtensionUiController } from "#src/agent/extension-ui-controller.ts";
import { AppStore } from "#src/state/app-store.ts";
import { assertEquals, assertThrows } from "#testing/assertions";

test("extension UI resolves queued web dialogs in order", async () => {
	const store = new AppStore();
	const controller = new ExtensionUiController(store);
	const ui = controller.context(() => true);

	const selected = ui.select("Choose", ["one", "two"]);
	const confirmed = ui.confirm("Continue?", "This changes things.");
	assertEquals(store.extensionDialog?.kind, "select");
	const selectId = store.extensionDialog?.id ?? "";
	assertEquals(controller.respond(selectId, "two", false), true);
	assertEquals(await selected, "two");

	assertEquals(store.extensionDialog?.kind, "confirm");
	const confirmId = store.extensionDialog?.id ?? "";
	assertEquals(controller.respond(confirmId, "confirm", false), true);
	assertEquals(await confirmed, true);
	assertEquals(store.extensionDialog, undefined);
});

test("extension UI cancels dialogs on abort, teardown, and inactive runtimes", async () => {
	const store = new AppStore();
	const controller = new ExtensionUiController(store);
	const abort = new AbortController();
	const ui = controller.context(() => true);
	const input = ui.input("Input", "value", { signal: abort.signal });
	abort.abort();

	assertEquals(await input, undefined);
	assertEquals(store.extensionDialog, undefined);

	const confirmed = ui.confirm("Continue?", "Pending confirmation");
	const selected = ui.select("Choose", ["one", "two"]);
	controller.cancelAll();
	assertEquals(await confirmed, false);
	assertEquals(await selected, undefined);
	assertEquals(store.extensionDialog, undefined);
	assertEquals(await controller.context(() => false).confirm("No", "No"), false);
});

test("extension UI rejects TUI-only capabilities explicitly", () => {
	const ui = new ExtensionUiController(new AppStore()).context(() => true);

	assertThrows(() => ui.onTerminalInput(() => undefined), Error, "raw terminal input");
	assertThrows(() => ui.setToolsExpanded(true), Error, "global tool expansion state");
	assertEquals({ ...ui }.theme, ui.theme);
	assertThrows(() => ui.theme.fg("accent", "text"), Error, "TUI themes");
	assertEquals(ui.setTheme("dark"), {
		success: false,
		error: "TUI themes are unavailable in pi-ui",
	});
});
