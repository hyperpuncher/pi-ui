// pi's built-in slash commands (`/settings`, `/model`, `/tree`, ...) are TUI-only:
// `session.prompt()` never recognizes them (docs/rpc.md: "Built-in TUI commands ...
// are not included [in get_commands]. They are handled only in interactive mode and
// would not execute if sent via prompt."). Left unhandled, typing e.g. "/settings" or
// "/fork" gets sent to the model as ordinary chat text instead of running the command
// or reporting it as unsupported. This module is the single source of truth for the
// catalog (mirrored 1:1 from the SDK so it never drifts) and for classifying an
// arbitrary "/name args" prompt against it, so `RuntimeController.prompt()` can give
// every built-in a native web-UI handling instead of silently forwarding it.
//
// SAFETY: `@earendil-works/pi-coding-agent`'s package.json "exports" map only publishes
// ".", "./rpc-entry", "./client", and "./experimental/plugin" — `dist/core/slash-commands.js`
// isn't part of the published surface. `runtime-controller.ts` already reaches into the
// same dist tree for `dist/core/model-resolver.js`'s `resolveModelScopeFromModels`; this
// mirrors that existing, accepted precedent rather than hand-duplicating a list that
// would silently drift from the SDK's own `BUILTIN_SLASH_COMMANDS` on every SDK bump.
import { BUILTIN_SLASH_COMMANDS } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js";
import type { AppSlashCommand } from "../state/app-store.ts";

/** Every argument-taking built-in pi-ui gives native handling to (see runtime-controller.ts `prompt()`). */
export type BuiltinCommandName =
	| "settings"
	| "model"
	| "tree"
	| "thinking"
	| "scoped-models"
	| "export"
	| "import"
	| "share"
	| "bug"
	| "copy"
	| "name"
	| "session"
	| "changelog"
	| "hotkeys"
	| "fork"
	| "clone"
	| "trust"
	| "login"
	| "logout"
	| "new"
	| "compact"
	| "resume"
	| "reload"
	| "quit";

const builtinCommandNames: ReadonlySet<string> = new Set(
	BUILTIN_SLASH_COMMANDS.map((command) => command.name),
);

/** `AppSlashCommand` rows for every pi built-in, for `AppStore.slashCommands` / the "/" picker. */
export const builtinSlashCommandCatalog: readonly AppSlashCommand[] =
	BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		description: command.description,
		source: "system",
		argumentHint: command.argumentHint,
	}));

export function isBuiltinCommandName(name: string): name is BuiltinCommandName {
	return builtinCommandNames.has(name);
}

export type ParsedSlashCommand = {
	/** Command name, lowercased, without the leading "/". */
	name: string;
	/** Everything after the first run of whitespace following the name, trimmed. */
	args: string;
};

/** Parses "/name rest of the line" from a trimmed prompt. Returns undefined for non-slash text. */
export function parseSlashCommand(trimmed: string): ParsedSlashCommand | undefined {
	if (!trimmed.startsWith("/")) return undefined;
	const withoutSlash = trimmed.slice(1);
	const spaceIndex = withoutSlash.search(/\s/);
	const name = (spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex))
		.trim()
		.toLowerCase();
	if (!name) return undefined;
	const args = spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1).trim();
	return { name, args };
}
