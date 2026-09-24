import type { JsonValue } from "../utils/json-types.ts";
import { isRecord, isString } from "../utils/type-guards.ts";

/**
 * How pi-ui binds pi SDK extensions (`session.bindExtensions({ mode })`).
 *
 * - `"tui"`: extensions see a real terminal-capable host. `custom()`, component
 *   `setWidget`/`setFooter`/`setHeader` factories, and `onTerminalInput` all work —
 *   pi-ui renders them as terminal surfaces (see `src/agent/terminal-surface/`).
 *   This is the default: it is a strict superset of what `"rpc"` extensions get,
 *   because every `ExtensionUIContext` method pi-ui implements works the same way
 *   in both modes, and `"tui"` additionally unlocks extensions gated on
 *   `ctx.mode === "tui"` (mcp/mcp-auth panels, bash-background and subagents key
 *   handling, the jev card, …) that would otherwise silently degrade to text.
 * - `"rpc"`: the pre-Round-4 behavior. Kept as an escape hatch in case a future
 *   extension's `"tui"`-gated code assumes a real terminal process (stdout writes,
 *   a TTY-only built-in) in a way pi-ui's shim doesn't cover.
 *
 * Positive-gated PIUI-bridge extensions (`ask_user`, `btw`, `todo`, `advisor`, …,
 * via `lib/bridge.ts`'s `bridgeIsLive()`) key off the RPC family of modes, not
 * `hasUI`, so binding `"tui"` alone would push them onto their `custom()`/TUI path
 * instead of their native PIUI sheet. To keep their HTML path under `"tui"`, pi-ui
 * sets `process.env.PI_UI_BRIDGE = "1"` before any extension loads (see
 * `applyExtensionsHostMarker` below) as a documented host-capability signal. An
 * extension's bridge helper opts in by honouring it in both `bridgeIsLive()`
 * (its top-level "use the bridge at all" gate) and its own internal
 * wire-delivery gate — both are needed: patching only the former leaves a
 * bridge-aware panel built but silently undelivered, since the delivery gate
 * still thinks it's a literal TUI (see README "extension compatibility"). A
 * helper must honour it only where it can round-trip (its `pi_ui_event`
 * reverse channel registered, a ui context to notify through); otherwise a
 * blocking prompt published into the void would wait forever.
 */
export type ExtensionsMode = "tui" | "rpc";

export type ExtensionsConfig = Readonly<{
	mode: ExtensionsMode;
}>;

export const defaultExtensionsConfig: ExtensionsConfig = { mode: "tui" };

/** The env var extensions' `lib/bridge.ts` can check to keep their PIUI-bridge
 * (native HTML) path live even when pi-ui binds them as `"tui"`. Set once, before
 * the first extension load, from the resolved {@link ExtensionsConfig}. */
export const extensionsHostMarkerEnvVar = "PI_UI_BRIDGE";

export function parseExtensionsConfig(value: JsonValue | undefined): ExtensionsConfig {
	if (!isRecord(value)) return defaultExtensionsConfig;
	const mode =
		isString(value.mode) && isExtensionsMode(value.mode)
			? value.mode
			: defaultExtensionsConfig.mode;
	return { mode };
}

function isExtensionsMode(value: string): value is ExtensionsMode {
	return value === "tui" || value === "rpc";
}

/** Sets the host-capability marker extensions' `lib/bridge.ts` can opt into (see
 * the module doc comment). A no-op for `"rpc"` mode, where `bridgeIsLive()`
 * already passes on `ctx.mode` alone. Idempotent and safe to call more than once
 * (e.g. once per `RuntimeController` in a multi-workspace process): the marker is
 * a process-wide, not per-runtime, signal. */
export function applyExtensionsHostMarker(config: ExtensionsConfig): void {
	if (config.mode !== "tui") return;
	process.env[extensionsHostMarkerEnvVar] = "1";
}
