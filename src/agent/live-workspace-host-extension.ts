import {
	createEventBus,
	type EventBus,
	type ExtensionAPI,
	type InlineExtension,
} from "@earendil-works/pi-coding-agent";

import type { JsonValue } from "../utils/json-types.ts";
import type { LiveWorkspaceController } from "./live-workspace-controller.ts";

const liveWorkspaceHostId = "pi-ui.live-workspace-host";

/**
 * Identifies which runtime a host-extension instance was loaded into. Every runtime gets its
 * own host extension (and its own `pi.events` bus), so the sink can drop updates from
 * background runtimes — background sessions must never bleed into the foreground pane.
 */
export type LiveWorkspaceHostOrigin = Readonly<{
	readonly kind: "live-workspace-origin";
}>;

export function createLiveWorkspaceHostOrigin(): LiveWorkspaceHostOrigin {
	return { kind: "live-workspace-origin" };
}

/**
 * Receives host-extension updates. The owner decides whether `origin` is the foreground
 * runtime, applies `update` to the shared controller, and publishes the result.
 */
export type LiveWorkspaceHostSink = (
	origin: LiveWorkspaceHostOrigin,
	update: (controller: LiveWorkspaceController) => void,
) => void;

/**
 * Hidden inline extension that taps cross-cutting session state for the Live Workspace pane:
 * extension-hook lifecycle events that never reach `AgentSessionEvent` (`ui_prompt_start`/
 * `end`, model and thinking-level selection). Every `pi.events` channel (subagent fleets,
 * background bash jobs, workflow/goal progress, and anything else an extension publishes) is
 * tapped separately, generically, by `createTappedEventBus` below — see A#27.
 *
 * Mirrors `llama-provider-extension.ts`'s injection shape. Every handler is defensively
 * wrapped: a malformed or throwing payload from a third-party extension must never propagate
 * into the pi SDK (AGENTS.md non-negotiable).
 */
export function createLiveWorkspaceHostExtension(
	sink: LiveWorkspaceHostSink,
	origin: LiveWorkspaceHostOrigin,
): InlineExtension {
	return {
		name: liveWorkspaceHostId,
		factory: (api) => registerLiveWorkspaceHost(api, sink, origin),
		hidden: true,
	};
}

function registerLiveWorkspaceHost(
	api: ExtensionAPI,
	sink: LiveWorkspaceHostSink,
	origin: LiveWorkspaceHostOrigin,
): void {
	const send = (update: (controller: LiveWorkspaceController) => void) =>
		guard(() => sink(origin, update));
	api.on("ui_prompt_start", (event) => {
		send((controller) => controller.recordUiPromptStart(event.kind, event.title));
	});
	api.on("ui_prompt_end", () => {
		send((controller) => controller.recordUiPromptEnd());
	});
	api.on("model_select", (event) => {
		send((controller) => controller.recordModelSelect(event.model.id, event.source));
	});
	api.on("thinking_level_select", (event) => {
		send((controller) =>
			controller.recordThinkingSelect(event.level, event.previousLevel),
		);
	});
}

function guard(run: () => void): void {
	try {
		run();
	} catch {
		// Extension-sourced payloads are untrusted; never let a malformed one escape this host.
	}
}

/**
 * A#27: taps EVERY `pi.events` channel an extension publishes to, not a hardcoded subset.
 *
 * `ExtensionAPI.events.on(channel, handler)` requires the channel name up front, so a fixed
 * list (the previous approach) silently misses anything the user's extensions add later. This
 * instead wraps a fresh `EventBus` and passes it as `resourceLoaderOptions.eventBus`, which the
 * SDK's resource loader uses as the ONE bus for every extension it loads for that session (see
 * `loadExtensionsCached`/`loadExtensionFromFactory` in pi-coding-agent's resource-loader) — so
 * every `ctx.events.emit(channel, payload)` call, from any extension, passes through `onEmit`
 * before reaching the real bus. Extensions keep calling `on`/`emit` exactly as before; this
 * changes nothing about their own delivery, it only adds an observer.
 */
export function createTappedEventBus(
	onEmit: (channel: string, payload: JsonValue) => void,
): EventBus {
	const bus = createEventBus();
	return {
		emit(channel, data) {
			guard(() => {
				// SAFETY: `pi.events` payloads are genuinely unstructured extension output —
				// this is the one boundary where an arbitrary emitted value is claimed as
				// `JsonValue` (matching `onChannel`'s payload contract in
				// `extension-ui-controller.ts`). `recordChannel` re-serializes through
				// `asDisplayableJson` regardless of this claimed shape, so a value that isn't
				// really JSON-safe still degrades safely, and `guard` drops anything that
				// throws along the way.
				onEmit(channel, data as JsonValue);
			});
			bus.emit(channel, data);
		},
		on: (channel, handler) => bus.on(channel, handler),
	};
}
