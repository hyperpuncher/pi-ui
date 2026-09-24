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

/**
 * End-to-end companion to the `bindExtensionsCount` regression tests in
 * `runtime-controller_test.ts`: those prove the *controller* binds extensions
 * once per transition using a scripted fake; this drives a real, filesystem-
 * discovered extension through the real SDK (`createAgentSessionRuntime`,
 * `AgentSession.bindExtensions()`), so a `session_start` double-delivery
 * bug that only shows up in the SDK's own bookkeeping — not in the fake's
 * script — would still be caught here.
 *
 * The fixture's `count` lives in the extension module's own closure, which
 * the SDK re-instantiates for every new session (see `agent-session.js`'s
 * `_extensionRunner = new ExtensionRunner(...)` at session construction). A
 * duplicate delivery to the *same* session therefore appends a second,
 * differently-numbered notice (`#2`) instead of silently overwriting the
 * first, the way a status or widget keyed by a fixed string would.
 */
const sessionStartFixtureSource = `
export default function (pi) {
  let count = 0;
  pi.on("session_start", (event, ctx) => {
    count += 1;
    ctx.ui.notify("session_start #" + count + " reason=" + event.reason, "info");
  });
}
`;

function sessionStartNotices(store: AppStore, fromIndex: number): string[] {
	return store.messages
		.slice(fromIndex)
		.map((message) => message.text)
		.filter((text): text is string => Boolean(text?.startsWith("session_start #")));
}

async function withFixture(
	run: (controller: RuntimeController, store: AppStore) => Promise<void>,
): Promise<void> {
	const root = await makeTempDir({ prefix: "pi-ui-session-start-once-" });
	const agentDir = `${root}/agent`;
	const sessionFileDir = `${root}/sessions`;
	const cwd = `${root}/workspace`;
	await mkdir(`${agentDir}/extensions`, { recursive: true });
	await mkdir(sessionFileDir, { recursive: true });
	await mkdir(cwd, { recursive: true });
	await Bun.write(
		`${agentDir}/extensions/session-start-count.js`,
		sessionStartFixtureSource,
	);

	const dependencies: RuntimeControllerDependencies = {
		createRuntime: (_factory, options) =>
			createAgentSessionRuntime(
				async ({ cwd: sessionCwd, sessionManager, sessionStartEvent }) => {
					const services = await createAgentSessionServices({
						cwd: sessionCwd,
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
		// Persisted (unlike `extension-ui-compatibility_test.ts`'s in-memory
		// sessions) so /new from the initial, never-prompted session takes the
		// idle-saved-session in-place path this suite exists to cover.
		createSessionManager: (cwd) => SessionManager.create(cwd, sessionFileDir),
		createMemorySessionManager: (cwd) => SessionManager.inMemory(cwd),
		forkSessionManager: (sourcePath, cwd) =>
			SessionManager.forkFrom(sourcePath, cwd, sessionFileDir),
		openSessionManager: (path) => SessionManager.open(path, sessionFileDir),
		moveToTrash: () => Promise.resolve(),
		shareSession: () =>
			Promise.resolve({
				shareUrl: "https://pi.dev/session/#fixture",
				gistUrl: "https://gist.github.com/fixture",
			}),
		getAgentDir: () => agentDir,
		notifySessionDone: () => Promise.resolve(),
	};

	const store = new AppStore();
	let controller: RuntimeController | undefined;
	try {
		controller = await RuntimeController.prepare(store, cwd, { dependencies });
		controller.activate();
		await run(controller, store);
	} finally {
		await controller?.dispose();
		await rm(root, { recursive: true, force: true });
	}
}

test("a real discovered extension gets session_start exactly once on activation", async () => {
	await withFixture(async (_controller, store) => {
		assertEquals(sessionStartNotices(store, 0), ["session_start #1 reason=startup"]);
	});
});

test("a real discovered extension gets session_start exactly once for /new from an idle saved session", async () => {
	await withFixture(async (controller, store) => {
		// `/new` resets the transcript (a fresh session's own, empty history),
		// so — unlike the temp-then-/new case below — there is nothing from the
		// previous session left to slice past.
		assertEquals((await controller.newSession()).status, "success");

		assertEquals(sessionStartNotices(store, 0), ["session_start #1 reason=new"]);
	});
});

test("a real discovered extension gets session_start exactly once for a new temporary session", async () => {
	await withFixture(async (controller, store) => {
		assertEquals((await controller.newTemporarySession()).status, "success");

		assertEquals(sessionStartNotices(store, 0), ["session_start #1 reason=new"]);
	});
});

test("a real discovered extension gets session_start exactly once for /new from a temporary session", async () => {
	await withFixture(async (controller, store) => {
		assertEquals((await controller.newTemporarySession()).status, "success");

		// The current session is now non-persisted, so this takes the
		// `replaceRuntime()` branch instead of the in-place one above.
		assertEquals((await controller.newSession()).status, "success");

		assertEquals(sessionStartNotices(store, 0), ["session_start #1 reason=new"]);
	});
});
