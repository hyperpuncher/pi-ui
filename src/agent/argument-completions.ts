// `getArgumentCompletions` (per-command, per-argument autocomplete) is a real part of the
// SDK's extension-command contract (types.d.ts's `RegisteredCommand.getArgumentCompletions`)
// but is never called anywhere in pi-ui — the slash picker only fuzzy-matches the command
// *name*. Anything that leans on rich argument completions (e.g. a fuzzy agent-name picker
// for `/subagent-selector <name>`) gets no completion surface at all. This module wires it
// up, with a timeout and error isolation so a misbehaving extension can't hang or crash the
// completions route, plus built-in completions for `/model` and `/thinking` (which aren't
// extension commands and so have no `getArgumentCompletions` of their own to call).
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import type { AppModel, AppThinkingLevel } from "../state/app-store.ts";

/** Extension commands get this long to answer before their completions are dropped. */
export const argumentCompletionsTimeoutMs = 2000;

// An extension's getArgumentCompletions (or a huge model/thinking-level catalog) could
// return an unbounded list; the picker renders every row into the DOM on every keystroke,
// so cap it defensively rather than trusting every current and future caller to do so.
export const argumentCompletionsResultLimit = 100;

function matchesQuery(candidate: string, query: string): boolean {
	return query === "" || candidate.toLowerCase().includes(query.toLowerCase());
}

function capCompletions(items: readonly AutocompleteItem[]): readonly AutocompleteItem[] {
	return items.length > argumentCompletionsResultLimit
		? items.slice(0, argumentCompletionsResultLimit)
		: items;
}

function modelCompletions(
	models: readonly AppModel[],
	argumentPrefix: string,
): AutocompleteItem[] {
	return models
		.values()
		.filter((model) => matchesQuery(`${model.provider}/${model.id}`, argumentPrefix))
		.map((model) => ({
			value: `${model.provider}/${model.id}`,
			label: `${model.provider}/${model.id}`,
			description: model.scoped ? `${model.name} • scoped` : model.name,
		}))
		.toArray();
}

function thinkingCompletions(
	levels: readonly AppThinkingLevel[],
	argumentPrefix: string,
): AutocompleteItem[] {
	return levels
		.values()
		.filter((level) => matchesQuery(level, argumentPrefix))
		.map((level) => ({ value: level, label: level }))
		.toArray();
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T | undefined> {
	return await new Promise<T | undefined>((resolve) => {
		const timer = setTimeout(() => resolve(undefined), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				resolve(undefined);
			},
		);
	});
}

/**
 * Resolves argument completions for `/<commandName> <argumentPrefix>`. Never throws — a
 * missing command, a command with no `getArgumentCompletions`, a rejected promise, or a
 * completion call that doesn't answer within `argumentCompletionsTimeoutMs` all resolve to
 * an empty list rather than surfacing an error to the picker.
 */
export async function resolveArgumentCompletions(
	runtime: AgentSessionRuntime,
	models: readonly AppModel[],
	thinkingLevels: readonly AppThinkingLevel[],
	commandName: string,
	argumentPrefix: string,
): Promise<readonly AutocompleteItem[]> {
	const name = commandName.trim().toLowerCase();
	if (!name) return [];
	if (name === "model") return capCompletions(modelCompletions(models, argumentPrefix));
	if (name === "thinking")
		return capCompletions(thinkingCompletions(thinkingLevels, argumentPrefix));

	const command = runtime.session.extensionRunner
		.getRegisteredCommands()
		.find((candidate) => candidate.invocationName.toLowerCase() === name);
	if (!command?.getArgumentCompletions) return [];
	try {
		const result = await withTimeout(
			Promise.resolve(command.getArgumentCompletions(argumentPrefix)),
			argumentCompletionsTimeoutMs,
		);
		return capCompletions(result ?? []);
	} catch {
		return [];
	}
}
