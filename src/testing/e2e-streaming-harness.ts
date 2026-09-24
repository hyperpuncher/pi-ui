// R3-F: real, in-process pi-ui wiring (AppStore -> RuntimeController -> UiRenderer ->
// DatastarClientHub) for end-to-end streaming tests, with the real pi SDK session
// machinery backed by the scripted, network-free provider in `fake-stream-provider.ts`
// instead of a stub. This is the same production wiring `src/server/app.ts` builds, minus
// the parts unrelated to streaming a turn (static assets, workspace review, ...).
//
// This deliberately does NOT override `RuntimeController`'s `dependencies.createRuntime`
// (the pattern `terminal-surface-e2e_test.ts` uses): that override replaces the whole
// session-runtime factory, including the closure that wires the Live Workspace's tapped
// `pi.events` bus (see `RuntimeController.prepare`'s local `createRuntime` and
// `createTappedEventBus` in `live-workspace-host-extension.ts`) — losing that wiring would
// make the `fleet_publish` tool's `subagents:fleet` events (and any other channel
// activity) invisible to the Agents tab. Instead this loads the fake-stream extension from
// disk, through `PI_CODING_AGENT_DIR`, exactly the way a real extension is discovered, so
// every bit of `RuntimeController`'s own wiring stays intact and only the model provider is
// fake. `PI_CODING_AGENT_DIR` is process-wide, so it is set for this harness's whole
// lifetime and restored on `dispose()` — the same save/restore convention
// `session-dir_test.ts` and `workflow-journal-reader_test.ts` already use in this repo.
import { mkdir, rm } from "node:fs/promises";

import { makeTempDir } from "#testing/temp";

import { RuntimeController } from "../agent/runtime-controller.ts";
import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { AppStore } from "../state/app-store.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import {
	fakeStreamModelRef,
	writeFakeStreamProviderExtensionFile,
} from "./fake-stream-provider.ts";

export interface StreamingHarness {
	root: string;
	cwd: string;
	agentDir: string;
	store: AppStore;
	controller: RuntimeController;
	renderer: UiRenderer;
	hub: DatastarClientHub;
	/** Opens a `/stream` SSE connection exactly as the real route does (see
	 * `src/server/routes/stream.ts`) — one per simulated browser tab. */
	openStream(signal: AbortSignal, clientId?: string): Response;
	dispose(): Promise<void>;
}

const agentDirEnvVar = "PI_CODING_AGENT_DIR";

export async function createStreamingHarness(): Promise<StreamingHarness> {
	const root = await makeTempDir({ prefix: "pi-ui-e2e-streaming-" });
	const agentDir = `${root}/agent`;
	const cwd = `${root}/workspace`;
	await mkdir(agentDir, { recursive: true });
	await mkdir(cwd, { recursive: true });
	await writeFakeStreamProviderExtensionFile(agentDir);

	const previousAgentDir = process.env[agentDirEnvVar];
	process.env[agentDirEnvVar] = agentDir;

	const restoreEnv = () => {
		if (previousAgentDir === undefined) delete process.env[agentDirEnvVar];
		else process.env[agentDirEnvVar] = previousAgentDir;
	};

	let controller: RuntimeController | undefined;
	try {
		const store = new AppStore();
		const hub = new DatastarClientHub();
		const renderer = new UiRenderer(store, hub);

		controller = await RuntimeController.create(store, cwd, {});
		// Narrow once, outside the closures below: TS can't carry the post-assignment
		// narrowing of a captured `let` through an arrow function boundary.
		const readyController = controller;
		const selected = await readyController.setModel(fakeStreamModelRef);
		if (!selected) {
			throw new Error(`Failed to select fake stream model ${fakeStreamModelRef}`);
		}

		let disposed = false;
		return {
			root,
			cwd,
			agentDir,
			store,
			controller: readyController,
			renderer,
			hub,
			openStream: (signal, clientId) => renderer.createStream(signal, clientId),
			async dispose() {
				if (disposed) return;
				disposed = true;
				hub.dispose();
				await readyController.dispose();
				restoreEnv();
				await removeRoot(root);
			},
		};
	} catch (error) {
		await controller?.dispose();
		restoreEnv();
		await removeRoot(root);
		throw error;
	}
}

export { waitForCondition } from "./assertions.ts";

/**
 * On Windows a just-exited `bash` tool child can keep a handle on its cwd (under `root`) for a
 * moment, so `rm` throws EBUSY/EPERM. Node's `maxRetries` retries exactly those codes with a
 * linear backoff (`retryDelay` × attempt).
 */
function removeRoot(root: string): Promise<void> {
	return rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
