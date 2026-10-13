import { appCommandCatalog, type AppCommandId } from "#src/commands/catalog.ts";
import type { JsonValue } from "#src/utils/json-types.ts";
import {
	ariaKeyshortcuts,
	canonicalShortcut,
	parseShortcut,
	shortcutMatchExpression,
	type ShortcutSpec,
} from "#src/utils/keyboard.ts";
import { isRecord, isString } from "#src/utils/type-guards.ts";

const focusKeybindIds = [
	"cycle-model-backward",
	"toggle-sessions",
	"focus-prompt",
	"focus-conversation",
	"focus-sessions",
	"focus-workspace-files",
	"focus-workspace-changes",
	"focus-workspace-editor",
] as const;

export type FocusKeybindId = (typeof focusKeybindIds)[number];

export type KeybindId = AppCommandId | FocusKeybindId;

export type KeybindOverrides = Partial<Record<KeybindId, string>>;

type KeybindDefinition = {
	shortcut: string;
	guardModal: boolean;
};

const focusKeybindDefaults: Record<FocusKeybindId, string> = {
	"cycle-model-backward": "ctrl shift P",
	"toggle-sessions": "ctrl B",
	"focus-prompt": "alt P",
	"focus-conversation": "alt C",
	"focus-sessions": "alt S",
	"focus-workspace-files": "alt F",
	"focus-workspace-changes": "alt G",
	"focus-workspace-editor": "alt E",
};

const modalGuardedKeybinds: ReadonlySet<KeybindId> = new Set([
	"toggle-minimal-mode",
	"toggle-tool-output",
	"focus-prompt",
	"focus-conversation",
	"focus-sessions",
	"focus-workspace-files",
	"focus-workspace-changes",
	"focus-workspace-editor",
]);

const defaultDefinitions = buildDefaultDefinitions();

let activeDefinitions = withOverrides({});

function buildDefaultDefinitions(): Map<KeybindId, KeybindDefinition> {
	const definitions = new Map<KeybindId, KeybindDefinition>();
	for (const command of appCommandCatalog) {
		if (!command.shortcut) continue;
		definitions.set(command.id, {
			shortcut: command.shortcut,
			guardModal: modalGuardedKeybinds.has(command.id),
		});
	}
	for (const id of focusKeybindIds) {
		definitions.set(id, {
			shortcut: focusKeybindDefaults[id],
			guardModal: modalGuardedKeybinds.has(id),
		});
	}
	return definitions;
}

function withOverrides(overrides: KeybindOverrides): Map<KeybindId, KeybindDefinition> {
	const definitions = new Map<KeybindId, KeybindDefinition>();
	for (const [id, definition] of defaultDefinitions) {
		definitions.set(id, {
			...definition,
			shortcut: overrides[id] ?? definition.shortcut,
		});
	}
	return definitions;
}

/**
 * Validate user overrides at the config boundary. Unknown ids, non-string
 * values, and chords without a non-typing modifier are dropped so a remap can
 * never hijack plain typing or reach a generated expression.
 */
export function parseKeybindOverrides(value: JsonValue | undefined): KeybindOverrides {
	if (!isRecord(value)) return {};
	const overrides: KeybindOverrides = {};
	for (const [id] of defaultDefinitions) {
		const spec = parseOverride(value[id]);
		if (spec) overrides[id] = canonicalShortcut(spec);
	}
	return overrides;
}

function parseOverride<Value>(value: Value): ShortcutSpec | undefined {
	if (!isString(value)) return undefined;
	const spec = parseShortcut(value);
	if (!spec || (!spec.primary && !spec.alt)) return undefined;
	return spec;
}

export function keybindIds(): KeybindId[] {
	return defaultDefinitions.keys().toArray();
}

export function setActiveKeybinds(overrides: KeybindOverrides): void {
	activeDefinitions = withOverrides(overrides);
}

export function activeKeybind(id: KeybindId): string {
	return activeDefinitions.get(id)?.shortcut ?? "";
}

export function keybindAria(...ids: KeybindId[]): string {
	return ids
		.flatMap((id) => {
			const spec = activeSpec(id);
			return spec ? [ariaKeyshortcuts(spec)] : [];
		})
		.join(" ");
}

export function keybindAction(id: KeybindId, action: string): string {
	const spec = activeSpec(id);
	if (!spec) return "";
	const match = shortcutMatchExpression(spec);
	const guard = activeDefinitions.get(id)?.guardModal
		? " && !document.querySelector(':modal')"
		: "";
	return `if (${match}${guard}) { evt.preventDefault(); ${action} }`;
}

export function keybindActions(
	...entries: readonly (readonly [KeybindId, string])[]
): string {
	return entries
		.map(([id, action]) => keybindAction(id, action))
		.filter(Boolean)
		.join(" ");
}

function activeSpec(id: KeybindId): ShortcutSpec | undefined {
	const definition = activeDefinitions.get(id);
	return definition ? parseShortcut(definition.shortcut) : undefined;
}
