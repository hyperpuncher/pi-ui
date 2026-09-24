import {
	clampTerminalSize,
	maxTerminalColumns,
} from "../../agent/terminal-surface/headless-terminal.ts";
import type { JsonValue } from "../../utils/json-types.ts";
import {
	ActionInputError,
	booleanField,
	enumField,
	jsonSizeField,
	nonnegativeIntegerField,
	optionalNonnegativeIntegerField,
	optionalString,
	readActionSignals,
	requiredString,
	stringField,
} from "../action-input.ts";
import { datastarResponse } from "../datastar.ts";
import { isDisplayClientId } from "../display-refresh.ts";
import type { RouteMap } from "../route.ts";
import { requireHost, type RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

/**
 * A raw terminal byte sequence (a keystroke, an escape sequence, pasted
 * text) forwarded to a mounted `pi-tui` component. Generous enough for a
 * bracketed paste of a large clipboard value, small enough that a
 * misbehaving client can't use this route to buffer unbounded memory.
 */
const maxTerminalInputBytes = 64 * 1024;

/**
 * Defensive caps on an untrusted PIUI action request (a click from an
 * extension-rendered button, form submit, or roster row action). These bound
 * worst-case memory for a misbehaving or malicious extension the same way
 * `pi-ui-bridge.ts`'s decoder caps element/channel state; a well-behaved
 * bridge payload never approaches them.
 */
const maxElementIdLength = 512;
const maxActionIdLength = 256;
const maxActionValueBytes = 64 * 1024;

/** A `KeyId` string (e.g. `"ctrl+shift+p"`) is at most a handful of tokens —
 * generous headroom over anything `matchesKeyId` would ever produce. */
const maxKeyIdLength = 64;
/** A single encoded keystroke (`encodeKeyEvent`'s output): an escape/CSI
 * sequence is a few bytes, and bracketed-paste text never reaches this route
 * (the client only forwards discrete `keydown`s, not `paste`) — generous
 * enough for a pasted-then-composed IME character without permitting the
 * unbounded buffering `terminalSurfaceInput`'s larger cap exists for. */
const maxPromptLevelInputBytes = 4 * 1024;

export const extensionUiRoutes = {
	[endpoints.extensionUiEditor]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			context.store.setPromptEditorText(stringField(signals, "prompt"), {
				broadcast: false,
			});
			return datastarResponse();
		},
	},
	[endpoints.extensionUiResponse]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			requireHost(context).respondExtensionUi(
				requiredString(signals, "extensionRequestId"),
				stringField(signals, "extensionResponse"),
				booleanField(signals, "extensionCancelled", { optional: true }),
			);
			return datastarResponse();
		},
	},
	[endpoints.extensionUiAction]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			// SAFETY: `value` is an arbitrary extension-defined JSON payload (a
			// form's collected field values, a roster row id, or nothing).
			// Datastar has already parsed the request body into JSON values, and
			// `jsonSizeField` has bounded its serialized size, so this narrows the
			// wire type (`Jsonifiable`, which also permits a nested `undefined`)
			// to the domain type this route forwards.
			const value = jsonSizeField(signals, "value", {
				maxBytes: maxActionValueBytes,
			}) as JsonValue | undefined;
			await requireHost(context).dispatchExtensionUiAction({
				elementId: requiredString(signals, "elementId", {
					maxLength: maxElementIdLength,
				}),
				actionId: requiredString(signals, "actionId", {
					maxLength: maxActionIdLength,
				}),
				value,
			});
			return datastarResponse();
		},
	},
	[endpoints.extensionUiColorScheme]: {
		POST: async (request, context) => {
			// The browser's real `prefers-color-scheme`, reported once per connection and on
			// change (see `pi-ui-elements.tsx`'s `renderPiUiSheets` mount script). No host is
			// required: `ExtensionUiController` reads this straight off `AppStore` (round-2
			// audit m9), so a bound runtime isn't a precondition the way the other routes here
			// need one for `dispatchExtensionUiAction`/terminal input.
			const signals = await readActionSignals(request);
			// `clientId` is the same per-tab id the stream connection and display-refresh Hz
			// reporting already carry (`page.tsx`'s `displayClientId`) — tracking the scheme
			// per client, instead of one shared scalar, is round-4 O4. A caller that doesn't
			// send one (an older client, or a direct signal post) falls back to the store's
			// legacy shared slot, matching the previous single-scalar behavior.
			const clientId = optionalString(signals, "clientId");
			if (clientId !== undefined && !isDisplayClientId(clientId)) {
				throw new ActionInputError("Invalid clientId.");
			}
			context.store.setClientColorScheme(
				enumField(signals, "colorScheme", ["light", "dark"] as const),
				clientId,
			);
			return datastarResponse();
		},
	},
	[endpoints.terminalViewport]: {
		POST: async (request, context) => {
			// Round 6 F2: the browser's whole-viewport terminal-cell grid, reported once per
			// connection and on window resize (`static/app/terminal-keys.js`'s
			// `reportViewportCells`) so a brand-new terminal surface — which has no grid of its
			// own to measure yet — can be seeded close to its true size instead of a fixed
			// 100x30 guess (see `AppStore.clientViewportCells`,
			// `TerminalSurfaceController`'s `viewportHint`). Same "no host required, tracked
			// per client" shape as `extensionUiColorScheme` just above, for the same reasons.
			const signals = await readActionSignals(request);
			const clientId = optionalString(signals, "clientId");
			if (clientId !== undefined && !isDisplayClientId(clientId)) {
				throw new ActionInputError("Invalid clientId.");
			}
			const size = clampTerminalSize({
				columns: nonnegativeIntegerField(signals, "cols"),
				rows: nonnegativeIntegerField(signals, "rows"),
			});
			// R7-B items 2 & 3: the client's own measured `#prompt-box` width and, for a
			// percentage-width overlay, the width its `N%` will resolve against once a real
			// dialog's chrome is subtracted — both optional (an older client, or a report sent
			// before `#prompt-box` exists) and clamped the same way `cols`/`rows` are.
			const promptColumns = clampReportedColumns(
				optionalNonnegativeIntegerField(signals, "promptCols"),
			);
			const overlayPercentColumns = clampReportedColumns(
				optionalNonnegativeIntegerField(signals, "overlayPercentCols"),
			);
			// The width a custom message/entry render card has in this tab's transcript, which
			// extension message/entry renderers render at (see
			// `AppStore.narrowestTranscriptColumns`). Optional and clamped like the others.
			const transcriptColumns = clampReportedColumns(
				optionalNonnegativeIntegerField(signals, "transcriptCols"),
			);
			context.store.setClientViewportCells(
				{ ...size, promptColumns, overlayPercentColumns, transcriptColumns },
				clientId,
			);
			return datastarResponse();
		},
	},
	[endpoints.terminalSurfaceInput]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const data = stringField(signals, "data");
			if (Buffer.byteLength(data, "utf8") > maxTerminalInputBytes) {
				throw new ActionInputError("data is too large.");
			}
			requireHost(context).handleTerminalSurfaceInput(
				requiredString(signals, "surfaceId", { maxLength: maxElementIdLength }),
				data,
			);
			return datastarResponse();
		},
	},
	[endpoints.extensionShortcutInvoke]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			requireHost(context).invokeExtensionShortcut(
				requiredString(signals, "keyId", { maxLength: maxKeyIdLength }),
			);
			return datastarResponse();
		},
	},
	[endpoints.extensionPromptInput]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const data = stringField(signals, "data");
			if (Buffer.byteLength(data, "utf8") > maxPromptLevelInputBytes) {
				throw new ActionInputError("data is too large.");
			}
			// Not `datastarResponse()`: the client (`static/app/extension-keys.ts`)
			// needs a synchronous yes/no to decide whether to type the key itself,
			// not a signal/element patch.
			const { consumed } = requireHost(context).handlePromptLevelInput(data);
			return new Response(JSON.stringify({ consumed }), {
				headers: { "content-type": "application/json" },
			});
		},
	},
	[endpoints.terminalSurfaceResize]: {
		POST: async (request, context) => {
			const signals = await readActionSignals(request);
			const clientId = optionalString(signals, "clientId");
			if (clientId !== undefined && !isDisplayClientId(clientId)) {
				throw new ActionInputError("Invalid clientId.");
			}
			requireHost(context).resizeTerminalSurface(
				requiredString(signals, "surfaceId", { maxLength: maxElementIdLength }),
				nonnegativeIntegerField(signals, "cols"),
				nonnegativeIntegerField(signals, "rows"),
				clientId,
			);
			return datastarResponse();
		},
	},
} satisfies RouteMap<RouteContext>;

/**
 * Clamps an optional client-reported column hint the same way `clampTerminalSize` clamps
 * `cols`/`rows` — an untrusted client could report anything, and this feeds
 * `TerminalSurfaceController`'s `viewportHint`, not a validated surface size of its own.
 */
function clampReportedColumns(value: number | undefined): number | undefined {
	return value === undefined
		? undefined
		: Math.max(minReportedColumns, Math.min(maxTerminalColumns, value));
}

/** A reported 0 (or a tiny value) must not size a surface or a render down to nothing. */
const minReportedColumns = 10;
