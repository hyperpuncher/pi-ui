import { test } from "bun:test";

import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { assertEquals } from "#testing/assertions";
import { mkdir, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { AppStore } from "../state/app-store.ts";
import {
	RuntimeController,
	type RuntimeControllerDependencies,
} from "./runtime-controller.ts";

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
	await writeTextFile(`${agentDir}/extensions/ui-fixture.js`, fixtureSource);

	const store = new AppStore();
	store.setPromptEditorText("browser draft");
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();

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
		await remove(root, { recursive: true });
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
