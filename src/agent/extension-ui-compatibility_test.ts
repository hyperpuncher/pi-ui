import { test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { assertEquals } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { AppStore } from "../state/app-store.ts";
import {
	RuntimeController,
	type RuntimeControllerDependencies,
} from "./runtime-controller.ts";

const piUiFixtureSource = `
export default function (pi) {
  pi.registerCommand("piui-fixture", {
    description: "Exercise the Pi UI Bridge (PIUI) protocol over notify()",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        "PIUI " + JSON.stringify({
          v: 1,
          op: "set",
          el: {
            id: "panel",
            ns: "fixture",
            kind: "panel",
            placement: "sheet",
            title: "Fixture panel",
            actions: [{ id: "go", label: "Go" }],
          },
        }),
        "info",
      );
    },
  });
  pi.registerCommand("pi_ui_event", {
    description: "Internal Pi UI Bridge action receiver",
    handler: async (args, ctx) => {
      const decoded = JSON.parse(Buffer.from(args, "base64url").toString("utf8"));
      ctx.ui.setStatus("piui-action", JSON.stringify(decoded));
    },
  });
}
`;

const fixtureSource = `
export default function (pi) {
  pi.registerCommand("ui-fixture", {
    description: "Exercise pi-ui extension UI compatibility",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("fixture", "running");
      ctx.ui.setWidget("fixture", ["extension widget"], { placement: "belowEditor" });
      ctx.ui.setWorkingMessage("fixture working");
      ctx.ui.setWorkingIndicator({ frames: ["*"] });
      ctx.ui.setTitle("fixture title");
      ctx.ui.pasteToEditor(" + extension");

      const selected = await ctx.ui.select("Select", ["one", "two"]);
      const confirmed = await ctx.ui.confirm("Confirm", "Continue?");
      const input = await ctx.ui.input("Input", "value");
      const edited = await ctx.ui.editor("Editor", "prefill");

      ctx.ui.notify(
        [selected, confirmed, input, edited, ctx.ui.getEditorText()].join("|"),
        "info",
      );
      ctx.ui.setStatus("fixture", undefined);
      ctx.ui.setWidget("fixture", undefined);
      ctx.ui.setWorkingMessage(undefined);
      ctx.ui.setWorkingIndicator(undefined);
      ctx.ui.setTitle("pi-ui");
    },
  });
}
`;

test("a discovered pi extension uses the web UI bridge end to end", async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/ui-fixture.js`, fixtureSource);

	const store = new AppStore();
	store.setPromptEditorText("browser draft");
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();
		assertEquals(
			store.slashCommands.find((command) => command.name === "ui-fixture"),
			{
				name: "ui-fixture",
				description: "Exercise pi-ui extension UI compatibility",
				source: "extension",
			},
		);

		const command = controller.prompt("/ui-fixture");
		await waitForDialog(store, "select");
		assertEquals(store.documentTitle, "fixture title");
		assertEquals(store.promptEditorText, "browser draft + extension");
		assertEquals(store.extensionStatuses, [{ key: "fixture", text: "running" }]);
		assertEquals(store.extensionWidgets[0]?.lines, ["extension widget"]);
		assertEquals(store.extensionWorkingMessage, "fixture working");

		respond(controller, store, "two");
		await waitForDialog(store, "confirm");
		respond(controller, store, "confirm");
		await waitForDialog(store, "input");
		respond(controller, store, "typed");
		await waitForDialog(store, "editor");
		respond(controller, store, "edited");

		assertEquals(await command, true);
		assertEquals(store.extensionDialog, undefined);
		assertEquals(store.extensionStatuses, []);
		assertEquals(store.extensionWidgets, []);
		assertEquals(store.extensionWorkingMessage, undefined);
		assertEquals(store.documentTitle, "pi-ui");
		assertEquals(
			store.messages.at(-1)?.text,
			"two|true|typed|edited|browser draft + extension",
		);
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

test("a bridge-aware extension's PIUI elements render natively and route actions back", async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/piui-fixture.js`, piUiFixtureSource);

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();

		const messagesBefore = store.messages.length;
		assertEquals(await controller.prompt("/piui-fixture"), true);

		// The PIUI element is decoded and rendered — never surfaced as a
		// transcript notice, no matter what `ctx.ui.notify()` shipped it as.
		assertEquals(store.messages.length, messagesBefore);
		assertEquals(store.extensionElements.length, 1);
		const element = store.extensionElements[0]!;
		assertEquals(element.ns, "fixture");
		assertEquals(element.id, "panel");
		assertEquals(element.kind, "panel");
		assertEquals(element.placement, "sheet");
		assertEquals(element.title, "Fixture panel");
		assertEquals(element.actions, [
			{ id: "go", label: "Go", variant: undefined, confirm: undefined },
		]);

		// A user action on the rendered element routes to the extension's own
		// `pi_ui_event` command handler — not through `session.prompt()`. The
		// browser only knows the element's bare id; the host resolves it to
		// the `${ns}:${id}` form `lib/bridge.ts` needs to route the reply to
		// the right namespace handler (A#22) before forwarding it.
		assertEquals(
			await controller.dispatchExtensionUiAction({
				elementId: "panel",
				actionId: "go",
				value: { confirmed: true },
			}),
			true,
		);
		await waitFor(() =>
			store.extensionStatuses.some((status) => status.key === "piui-action"),
		);
		assertEquals(
			JSON.parse(
				store.extensionStatuses.find((status) => status.key === "piui-action")!
					.text,
			),
			{ elementId: "fixture:panel", actionId: "go", value: { confirmed: true } },
		);
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

const throwingFixtureSource = `
export default function (pi) {
  pi.registerCommand("ui-throws", {
    description: "Extension command that throws mid-handler",
    handler: async (_args, ctx) => {
      // Opens (and leaves open) a dialog before throwing, so the test can
      // confirm the queue recovers rather than getting stuck on this one.
      const selectPromise = ctx.ui.select("Pick one", ["a", "b"]);
      selectPromise.catch(() => {});
      throw new Error("fixture command failed");
    },
  });
  pi.registerCommand("ui-after-throw", {
    description: "Runs after ui-throws to prove the dialog queue recovered",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Still working?", "Yes");
      ctx.ui.notify("after-throw:" + confirmed, "info");
    },
  });
}
`;

const fullFixtureSource = `
export default function (pi) {
  pi.registerCommand("ui-full-fixture", {
    description: "Exercise every remaining ExtensionUIContext member",
    handler: async (_args, ctx) => {
      const results = {};

      // onTerminalInput: registers and unsubscribes without throwing.
      const unsubscribe = ctx.ui.onTerminalInput(() => undefined);
      unsubscribe();
      results.onTerminalInput = true;

      ctx.ui.setWorkingVisible(false);
      results.setWorkingVisible = true;

      ctx.ui.setHiddenThinkingLabel("Thinking (hidden)");
      results.setHiddenThinkingLabel = true;

      ctx.ui.addAutocompleteProvider((current) => current);
      results.addAutocompleteProvider = true;

      const editorFactory = (tui, theme, keybindings) => ({ render: () => [] });
      ctx.ui.setEditorComponent(editorFactory);
      results.setEditorComponent =
        ctx.ui.getEditorComponent() === editorFactory;
      ctx.ui.setEditorComponent(undefined);

      ctx.ui.setFooter((tui, theme, footerData) => ({ render: () => [] }));
      ctx.ui.setFooter(undefined);
      results.setFooter = true;

      ctx.ui.setHeader((tui, theme) => ({ render: () => [] }));
      ctx.ui.setHeader(undefined);
      results.setHeader = true;

      // custom() mounts a real terminal surface now; the component resolves it
      // through done(), exactly like a TUI overlay would.
      const customResult = await ctx.ui.custom((tui, theme, keybindings, done) => {
        done("custom-done");
        return { render: () => ["custom"], invalidate: () => {} };
      });
      results.custom = customResult === "custom-done";

      results.theme =
        ctx.ui.theme.fg("accent", "text") === "text" &&
        ctx.ui.theme.bold("text") === "text";

      results.getAllThemes = Array.isArray(ctx.ui.getAllThemes())
        && ctx.ui.getAllThemes().length === 0;
      results.getTheme = ctx.ui.getTheme("dark") === undefined;
      const setThemeResult = ctx.ui.setTheme("dark");
      results.setTheme =
        setThemeResult.success === false && typeof setThemeResult.error === "string";

      const before = ctx.ui.getToolsExpanded();
      ctx.ui.setToolsExpanded(!before);
      results.toolsExpanded = ctx.ui.getToolsExpanded() === !before;
      ctx.ui.setToolsExpanded(before);

      ctx.ui.notify("RESULTS " + JSON.stringify(results), "info");
    },
  });
}
`;

test("a discovered pi extension can drive every remaining ExtensionUIContext member without throwing", async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/ui-full-fixture.js`, fullFixtureSource);

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();

		assertEquals(await controller.prompt("/ui-full-fixture"), true);

		const resultsText = store.messages.at(-1)?.text ?? "";
		assertEquals(resultsText.startsWith("RESULTS "), true);
		const results: Record<string, boolean> = JSON.parse(
			resultsText.slice("RESULTS ".length),
		);
		// Every member ran to completion and self-checked true — including the
		// members `extension-ui-controller_test.ts` only exercises directly
		// against `ExtensionUiController`, this time end to end through a real
		// discovered extension and `RuntimeController.prompt()`.
		assertEquals(
			Object.entries(results).filter(([, ok]) => !ok),
			[],
		);
		assertEquals(Object.keys(results).sort(), [
			"addAutocompleteProvider",
			"custom",
			"getAllThemes",
			"getTheme",
			"onTerminalInput",
			"setEditorComponent",
			"setFooter",
			"setHeader",
			"setHiddenThinkingLabel",
			"setTheme",
			"setWorkingVisible",
			"theme",
			"toolsExpanded",
		]);
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

test("a command that throws is surfaced as an error and the dialog queue recovers", async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/ui-throws.js`, throwingFixtureSource);

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();

		// The SDK catches the handler's throw internally — `prompt()` itself
		// still resolves normally — and reports it only through `onError`.
		assertEquals(await controller.prompt("/ui-throws"), true);

		assertEquals(
			store.messages.at(-1)?.text,
			"Extension command failed: fixture command failed",
		);
		assertEquals(store.messages.at(-1)?.state, "error");
		// The select() dialog the throwing handler opened (and never resolved)
		// must not be left stuck forever.
		assertEquals(store.extensionDialog, undefined);

		// A later command's own dialog opens and resolves normally — the queue
		// was not left blocked by the orphaned dialog.
		const afterThrow = controller.prompt("/ui-after-throw");
		await waitForDialog(store, "confirm");
		respond(controller, store, "confirm");
		assertEquals(await afterThrow, true);
		assertEquals(store.messages.at(-1)?.text, "after-throw:true");
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

const modeFixtureSource = `
export default function (pi) {
  pi.registerCommand("ui-mode", {
    description: "Reports ctx.mode and ctx.hasUI",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify({ mode: ctx.mode, hasUI: ctx.hasUI }), "info");
    },
  });
}
`;

test('extensions bind as "tui" by default (R4-A)', async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/ui-mode.js`, modeFixtureSource);

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();

		assertEquals(await controller.prompt("/ui-mode"), true);
		assertEquals(JSON.parse(store.messages.at(-1)?.text ?? ""), {
			mode: "tui",
			hasUI: true,
		});
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

test('extensionsMode: "rpc" keeps the pre-Round-4 binding as an escape hatch', async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/ui-mode.js`, modeFixtureSource);

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
			extensionsMode: "rpc",
		});
		controller.activate();

		assertEquals(await controller.prompt("/ui-mode"), true);
		assertEquals(JSON.parse(store.messages.at(-1)?.text ?? ""), {
			mode: "rpc",
			hasUI: true,
		});
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

function dependencies(agentDir: string): RuntimeControllerDependencies {
	return {
		createRuntime: (_factory, options) =>
			createAgentSessionRuntime(
				async ({ cwd, sessionManager, sessionStartEvent }) => {
					const services = await createAgentSessionServices({
						cwd,
						agentDir,
						resourceLoaderOptions: {
							noSkills: true,
							noPromptTemplates: true,
							noThemes: true,
						},
					});
					const session = await createAgentSessionFromServices({
						services,
						sessionManager,
						sessionStartEvent,
					});
					return { ...session, services, diagnostics: services.diagnostics };
				},
				options,
			),
		prepareSessions: () => Promise.resolve({ ok: true, sessions: [] }),
		createSessionManager: (cwd) => SessionManager.inMemory(cwd),
		createMemorySessionManager: (cwd) => SessionManager.inMemory(cwd),
		forkSessionManager: SessionManager.forkFrom,
		openSessionManager: () => SessionManager.inMemory(),
		moveToTrash: () => Promise.resolve(),
		shareSession: () =>
			Promise.resolve({
				shareUrl: "https://pi.dev/session/#fixture",
				gistUrl: "https://gist.github.com/fixture",
			}),
		getAgentDir: () => agentDir,
		notifySessionDone: () => Promise.resolve(),
	};
}

async function waitForDialog(
	store: AppStore,
	kind: "select" | "confirm" | "input" | "editor",
): Promise<void> {
	for (let attempt = 0; attempt < 1_000; attempt += 1) {
		if (store.extensionDialog?.kind === kind) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error(`extension dialog ${kind} did not open`);
}

function respond(controller: RuntimeController, store: AppStore, value: string): void {
	const id = store.extensionDialog?.id;
	if (!id) throw new Error("extension dialog is not open");
	assertEquals(controller.respondExtensionUi(id, value, false), true);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 1_000; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition did not become true in time");
}
