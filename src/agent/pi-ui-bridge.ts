import {
	type ExtensionChannelSnapshot,
	type PiUiAction,
	type PiUiElement,
	type PiUiKind,
	type PiUiPlacement,
	piUiKinds,
	piUiMarker,
	piUiPlacements,
} from "../extension-surface-types.ts";
import type { JsonObject, JsonValue } from "../utils/json-types.ts";
import { isJsonObject, isNumber, isString } from "../utils/type-guards.ts";

/**
 * Decoder + element store for the "Pi UI Bridge" (PIUI) wire vocabulary that
 * bridge-aware extensions emit through `ctx.ui.notify("PIUI " + json)` when a
 * live RPC-mode client is attached (see `~/.pi/agent/extensions/lib/bridge.ts`).
 *
 * pi-ui declares `mode: "rpc"` when binding extensions (see
 * `extension-ui-controller.ts`), which makes `bridge.ts`'s `bridgeIsLive()`
 * gate pass — this is a live, currently-reachable protocol for this user's
 * extension set, not a hypothetical. Every input here is untrusted extension
 * output: decoding never throws, and every accumulation is bounded so a
 * runaway or malicious extension cannot grow pi-ui's memory or CPU use
 * without limit.
 */

// Defensive caps. `bridge.ts` itself already caps a single non-chunked
// message at 32 KiB and slices oversized payloads into ~28 KiB pieces
// (`PIUI_MAX_BYTES`/`CHUNK_SLICE`); these ceilings are deliberately looser
// than that sender-side contract so well-behaved extensions never trip them,
// while still bounding worst-case memory for a misbehaving one.
const maxDecodedMessageBytes = 256 * 1024;
const maxChunkPieceBytes = 64 * 1024;
const maxChunksPerMessage = 128;
const maxPendingChunkBuffers = 16;
const maxElements = 200;
const maxAppendedEntries = 500;
const maxChannels = 64;

export type PiUiOp =
	| { op: "set" | "upsert"; el: JsonObject }
	| { op: "patch"; id: string; ns: string; patch: JsonObject }
	| { op: "append"; id: string; ns: string; data: JsonValue }
	| { op: "remove"; id: string; ns: string }
	| { op: "channel"; channel: string; payload: JsonValue };

type ChunkBuffer = { total: number; parts: Map<number, string>; bytes: number };

/**
 * Decodes `"PIUI " + json` `notify()` payloads, reassembling the `chunk` op's
 * slices for payloads too large to send in one message. Malformed, oversized,
 * or partial input is dropped (returns `undefined`) rather than thrown — a
 * misbehaving extension must never be able to crash or hang pi-ui's notify path.
 */
export class PiUiBridgeDecoder {
	readonly #chunks = new Map<string, ChunkBuffer>();
	#lastMessage: string | undefined;

	/** True when `message` carries the PIUI marker prefix, before any decoding. */
	static isPiUiMessage(message: string): boolean {
		return message.startsWith(piUiMarker);
	}

	/**
	 * Decodes one `notify()` payload. Returns the operation once fully
	 * available, or `undefined` for a non-PIUI message, a still-incomplete
	 * chunk sequence, or anything that fails validation.
	 */
	decode(message: string): PiUiOp | undefined {
		if (!message.startsWith(piUiMarker)) return undefined;
		// `lib/bridge.ts`'s `notifyRaw()` hands every payload to `ui.notify()` twice (through
		// `ui.notify(msg, "info")` and again through `ctxRef.ui.notify(msg)`, which is the same
		// UI context). Every payload carries a fresh `agentSeq` (and every chunk a unique
		// id + index), so an identical consecutive message is always that duplicate — applying
		// it again would, for example, append every log line twice.
		if (message === this.#lastMessage) return undefined;
		this.#lastMessage = message;
		const body = message.slice(piUiMarker.length);
		if (body.length > maxDecodedMessageBytes) return undefined;
		const parsed = safeParseJsonObject(body);
		if (!parsed) return undefined;
		if (parsed.op === "chunk") return this.#reassemble(parsed);
		return normalizeOp(parsed);
	}

	/** Clears any in-flight chunk reassembly buffers, e.g. on session switch. */
	reset(): void {
		this.#chunks.clear();
		this.#lastMessage = undefined;
	}

	#reassemble(chunk: JsonObject): PiUiOp | undefined {
		const id = isString(chunk.id) ? chunk.id : undefined;
		const index = isNumber(chunk.i) ? chunk.i : undefined;
		const total = isNumber(chunk.n) ? chunk.n : undefined;
		const data = isString(chunk.data) ? chunk.data : undefined;
		if (
			id === undefined ||
			index === undefined ||
			total === undefined ||
			data === undefined
		) {
			return undefined;
		}
		if (total <= 0 || total > maxChunksPerMessage) return undefined;
		if (index < 0 || index >= total) return undefined;
		if (data.length > maxChunkPieceBytes) {
			this.#chunks.delete(id);
			return undefined;
		}
		let buffer = this.#chunks.get(id);
		if (!buffer) {
			if (this.#chunks.size >= maxPendingChunkBuffers) {
				// A misbehaving/spammy sender must not grow this map unboundedly;
				// evict the oldest in-flight buffer to make room.
				const oldest = this.#chunks.keys().next().value;
				if (oldest !== undefined) this.#chunks.delete(oldest);
			}
			buffer = { total, parts: new Map(), bytes: 0 };
			this.#chunks.set(id, buffer);
		}
		if (buffer.total !== total) {
			// A chunk id was reused with a different declared length: drop the
			// stale buffer rather than guess which sequence is authoritative.
			this.#chunks.delete(id);
			return undefined;
		}
		if (!buffer.parts.has(index)) buffer.bytes += data.length;
		if (buffer.bytes > maxDecodedMessageBytes) {
			this.#chunks.delete(id);
			return undefined;
		}
		buffer.parts.set(index, data);
		if (buffer.parts.size < buffer.total) return undefined;
		this.#chunks.delete(id);
		const pieces: string[] = [];
		for (let position = 0; position < buffer.total; position += 1) {
			const piece = buffer.parts.get(position);
			if (piece === undefined) return undefined;
			pieces.push(piece);
		}
		const parsed = safeParseJsonObject(pieces.join(""));
		return parsed ? normalizeOp(parsed) : undefined;
	}
}

function safeParseJsonObject(text: string): JsonObject | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return isJsonObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function normalizeOp(value: JsonObject): PiUiOp | undefined {
	switch (value.op) {
		case "set":
		case "upsert": {
			const el = value.el ?? value.element;
			return isJsonObject(el) ? { op: value.op, el } : undefined;
		}
		case "patch": {
			const { id, ns, patch } = value;
			if (!isString(id) || !isString(ns) || !isJsonObject(patch)) {
				return undefined;
			}
			return { op: "patch", id, ns, patch };
		}
		case "append": {
			const { id, ns, data } = value;
			if (!isString(id) || !isString(ns) || data === undefined) {
				return undefined;
			}
			return { op: "append", id, ns, data };
		}
		case "remove": {
			const { id, ns } = value;
			return isString(id) && isString(ns) ? { op: "remove", id, ns } : undefined;
		}
		case "channel": {
			const { channel, payload } = value;
			if (!isString(channel) || payload === undefined) return undefined;
			return { op: "channel", channel, payload };
		}
		default:
			return undefined;
	}
}

const envelopeKeys = new Set([
	"id",
	"ns",
	"kind",
	"placement",
	"title",
	"actions",
	"durable",
]);

/**
 * Applies decoded {@link PiUiOp}s onto a bounded collection of
 * {@link PiUiElement}s and the latest payload per `channel` op. Elements are
 * keyed by `ns` + `id` (an extension's own `id` alone is not guaranteed
 * unique across extensions), but the original, unprefixed `id`/`ns` are kept
 * on the element so a reply action can address it exactly as the extension
 * sent it (see `pi_ui_event`'s handler lookup in `lib/bridge.ts`).
 */
export class PiUiElementStore {
	readonly #elements = new Map<string, PiUiElement>();
	readonly #channels = new Map<string, ExtensionChannelSnapshot>();
	#revision = 0;

	apply(op: PiUiOp): boolean {
		switch (op.op) {
			case "set":
			case "upsert":
				return this.#set(op.el);
			case "patch":
				return this.#patch(op.id, op.ns, op.patch);
			case "append":
				return this.#append(op.id, op.ns, op.data);
			case "remove":
				return this.#remove(op.id, op.ns);
			case "channel":
				return this.#channel(op.channel, op.payload);
		}
	}

	elements(): PiUiElement[] {
		return [...this.#elements.values()];
	}

	channels(): ExtensionChannelSnapshot[] {
		return [...this.#channels.values()];
	}

	/**
	 * The `ns` a currently-known, unprefixed `id` belongs to — used to
	 * reconstruct the `${ns}:${id}` form `lib/bridge.ts` expects on an action
	 * reply (see `PiUiActionRequest`/`dispatchExtensionUiAction`). Returns
	 * `undefined` when no element with that bare id is known, or when more
	 * than one namespace currently owns that id (an ambiguous bare id is left
	 * unprefixed rather than guessing wrong).
	 */
	findNamespace(id: string): string | undefined {
		let found: string | undefined;
		for (const element of this.#elements.values()) {
			if (element.id !== id) continue;
			if (found !== undefined && found !== element.ns) return undefined;
			found = element.ns;
		}
		return found;
	}

	clear(): void {
		this.#elements.clear();
		this.#channels.clear();
	}

	#set(el: JsonObject): boolean {
		const id = isString(el.id) ? el.id : undefined;
		const ns = isString(el.ns) ? el.ns : undefined;
		const kind = isPiUiKind(el.kind) ? el.kind : undefined;
		if (!id || !ns || !kind) return false;
		const key = elementKey(ns, id);
		if (!this.#elements.has(key) && this.#elements.size >= maxElements) return false;
		const placement = isPiUiPlacement(el.placement) ? el.placement : "inline";
		const data: JsonObject = {};
		for (const [field, value] of Object.entries(el)) {
			if (!envelopeKeys.has(field)) data[field] = value;
		}
		// `set`/`upsert` is a deliberate (re)show — both `revision` and `openGeneration` bump
		// together here (unlike `#patch`/`#append` below, which only bump `revision`).
		const revision = this.#nextRevision();
		const openGeneration = nextOpenGeneration();
		this.#elements.set(key, {
			id,
			ns,
			kind,
			placement,
			title: isString(el.title) ? el.title : undefined,
			actions: normalizeActions(el.actions),
			durable: el.durable === true,
			data,
			revision,
			openGeneration,
			updatedAt: Date.now(),
		});
		return true;
	}

	#patch(id: string, ns: string, patch: JsonObject): boolean {
		const key = elementKey(ns, id);
		const existing = this.#elements.get(key);
		if (!existing) return false;
		const data = { ...existing.data };
		let title = existing.title;
		let actions = existing.actions;
		let durable = existing.durable;
		for (const [field, value] of Object.entries(patch)) {
			if (field === "title") title = isString(value) ? value : title;
			else if (field === "actions") actions = normalizeActions(value) ?? actions;
			else if (field === "durable") durable = value === true;
			else if (field !== "id" && field !== "ns" && field !== "kind") {
				data[field] = value;
			}
		}
		this.#elements.set(key, {
			...existing,
			title,
			actions,
			durable,
			data,
			revision: this.#nextRevision(),
			updatedAt: Date.now(),
		});
		return true;
	}

	#append(id: string, ns: string, value: JsonValue): boolean {
		const key = elementKey(ns, id);
		const existing = this.#elements.get(key);
		if (!existing) return false;
		const lines = Array.isArray(existing.data.lines) ? [...existing.data.lines] : [];
		lines.push(value);
		if (lines.length > maxAppendedEntries) {
			lines.splice(0, lines.length - maxAppendedEntries);
		}
		this.#elements.set(key, {
			...existing,
			data: { ...existing.data, lines },
			revision: this.#nextRevision(),
			updatedAt: Date.now(),
		});
		return true;
	}

	#remove(id: string, ns: string): boolean {
		return this.#elements.delete(elementKey(ns, id));
	}

	#channel(channel: string, payload: JsonValue): boolean {
		if (!this.#channels.has(channel) && this.#channels.size >= maxChannels) {
			// A misbehaving/spammy sender must not grow this map unboundedly;
			// evict the oldest channel (by first publish — `Map` keeps insertion
			// order and updating a key does not move it) to make room, mirroring
			// the chunk-buffer eviction above.
			const oldest = this.#channels.keys().next().value;
			if (oldest !== undefined) this.#channels.delete(oldest);
		}
		this.#channels.set(channel, { channel, payload, updatedAt: Date.now() });
		return true;
	}

	#nextRevision(): number {
		this.#revision += 1;
		return this.#revision;
	}
}

let lastOpenGeneration = 0;

/**
 * A browser remembers a dismissed sheet by its dialog id and `openGeneration`
 * (`piUiDismissedStorageKey`, in localStorage), and that memory outlives this store — a new
 * session, `/reload`, a server restart. A per-store counter restarting at 1 therefore made a
 * brand-new sheet (the first `/btw` after a restart) look already dismissed, so it never
 * opened. Wall-clock milliseconds, forced strictly increasing within the process, never repeat.
 */
function nextOpenGeneration(): number {
	lastOpenGeneration = Math.max(Date.now(), lastOpenGeneration + 1);
	return lastOpenGeneration;
}

function elementKey(ns: string, id: string): string {
	return `${ns}\u0000${id}`;
}

function isPiUiKind(value: JsonValue | undefined): value is PiUiKind {
	// SAFETY: `piUiKinds` is a readonly array of `PiUiKind` string literals;
	// widening it to `readonly string[]` only relaxes `.includes`'s element
	// type so it can be checked against an arbitrary decoded string, it does
	// not change which runtime values are considered members.
	return isString(value) && (piUiKinds as readonly string[]).includes(value);
}

function isPiUiPlacement(value: JsonValue | undefined): value is PiUiPlacement {
	// SAFETY: `piUiPlacements` is a readonly array of `PiUiPlacement` string
	// literals; see the identical widening note on `isPiUiKind` above.
	return isString(value) && (piUiPlacements as readonly string[]).includes(value);
}

function normalizeActions(
	value: JsonValue | undefined,
): readonly PiUiAction[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const actions: PiUiAction[] = [];
	for (const candidate of value) {
		if (!isJsonObject(candidate)) continue;
		const { id, label } = candidate;
		if (!isString(id) || !isString(label)) continue;
		const variant = candidate.variant;
		actions.push({
			id,
			label,
			variant:
				variant === "primary" || variant === "secondary" || variant === "danger"
					? variant
					: undefined,
			confirm: isString(candidate.confirm) ? candidate.confirm : undefined,
		});
	}
	return actions;
}
