import { test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";

import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { AppStore } from "../../state/app-store.ts";
import {
	RuntimeController,
	type RuntimeControllerDependencies,
} from "../runtime-controller.ts";

/**
 * A real extension, loaded from disk exactly as `discoverAndLoadExtensions`
 * would find it, that mounts two genuine `pi-tui` built-ins through the
 * terminal-surface host: a `SelectList` via `ctx.ui.custom()` (an overlay
 * surface, keyboard-driven) and a `Text` component via `ctx.ui.setWidget()`
 * (a persistent surface, "streamed" through repeated `setText()` calls). This
 * is the end-to-end path the Round 2 plan calls "the single most important
 * remaining capability" — every other wiring test in this repo exercises the
 * controller or the routes in isolation; this one runs a real extension
 * through the real `RuntimeController`.
 */
const fixtureSource = `
import { SelectList, Text } from "@earendil-works/pi-tui";

export default function (pi) {
	pi.registerCommand("terminal-fixture", {
		description: "Exercise the terminal-surface host with pi-tui components",
		handler: async (_args, ctx) => {
			let stream;
			ctx.ui.setWidget("stream", (_tui, _theme) => {
				stream = new Text("streaming: step 1");
				return stream;
			});

			const selected = await ctx.ui.custom(
				(_tui, theme, _keybindings, done) => {
					const selectListTheme = {
						selectedPrefix: (text) => theme.fg("accent", text),
						selectedText: (text) => theme.fg("accent", text),
						description: (text) => theme.fg("muted", text),
						scrollInfo: (text) => theme.fg("muted", text),
						noMatch: (text) => theme.fg("muted", text),
					};
					const list = new SelectList(
						[
							{ value: "one", label: "One" },
							{ value: "two", label: "Two" },
						],
						5,
						selectListTheme,
					);
					list.onSelect = (item) => {
						if (stream) stream.setText("streaming: chosen " + item.value);
						done(item.value);
					};
					return list;
				},
				{ overlay: true },
			);

			ctx.ui.setWidget("stream", undefined);
			ctx.ui.notify("selected:" + selected, "info");
		},
	});
}
`;

test("a discovered extension drives a real pi-tui SelectList and a streaming Text widget end to end", async () => {
	const root = await makeTempDir();
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(cwd);
	await Bun.write(`${agentDir}/extensions/terminal-fixture.js`, fixtureSource);

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, {
			dependencies: dependencies(agentDir),
		});
		controller.activate();

		const command = controller.prompt("/terminal-fixture");

		// The Text widget mounts first (setWidget is synchronous) — its
		// rendered HTML lines carry the real Text component's output.
		await waitFor(() =>
			store
				.snapshot()
				.terminalSurfaces.some((surface) => surface.kind === "widget"),
		);
		const widgetLines = surfaceLines(store, "widget");
		assertStringIncludes(widgetLines, "streaming: step 1");

		// The SelectList overlay mounts next — its rendered HTML lines carry
		// both real pi-tui SelectList item labels.
		await waitFor(() =>
			store
				.snapshot()
				.terminalSurfaces.some((surface) => surface.kind === "overlay"),
		);
		const overlay = store
			.snapshot()
			.terminalSurfaces.find((surface) => surface.kind === "overlay");
		if (!overlay) throw new Error("overlay surface did not mount");
		const overlayLines = overlay.lines.join("\n");
		assertStringIncludes(overlayLines, "One");
		assertStringIncludes(overlayLines, "Two");

		// Drive the SelectList with real terminal byte sequences (down arrow,
		// then enter) routed through the exact route handlers use:
		// `RuntimeController.handleTerminalSurfaceInput`.
		// The selection marker must visibly move to "Two": the component
		// mutates its state without requesting a render, so this proves the
		// host re-renders after dispatching input.
		const selectedLine = () =>
			(
				store.snapshot().terminalSurfaces.find((s) => s.id === overlay.id)
					?.lines ?? []
			).find((line) => line.includes("→"));
		assertStringIncludes(selectedLine() ?? "", "One");
		assertEquals(controller.handleTerminalSurfaceInput(overlay.id, "\u001b[B"), true);
		await waitFor(() => selectedLine()?.includes("Two") ?? false);
		assertEquals(controller.handleTerminalSurfaceInput(overlay.id, "\r"), true);

		// done() disposes the overlay and resolves the command's await.
		assertEquals(await command, true);
		assertEquals(
			store
				.snapshot()
				.terminalSurfaces.some((surface) => surface.id === overlay.id),
			false,
		);

		// The Text widget was "streamed" (setText()) before the overlay
		// resolved, and the command's own notify() reports the real
		// SelectList selection — not a stub.
		assertEquals(store.messages.at(-1)?.text, "selected:two");
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true });
	}
});

function surfaceLines(
	store: AppStore,
	kind: "overlay" | "inline" | "widget" | "footer" | "header",
): string {
	return store
		.snapshot()
		.terminalSurfaces.filter((surface) => surface.kind === kind)
		.flatMap((surface) => surface.lines)
		.join("\n");
}

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

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 2_000; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition did not become true in time");
}
