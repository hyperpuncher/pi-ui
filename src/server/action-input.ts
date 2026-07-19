import { ServerSentEventGenerator as ds } from "@starfederation/datastar-sdk/web";

import { isRecord } from "../utils/type-guards.ts";

export class ActionInputError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "ActionInputError";
	}
}

export type ActionSignals = Readonly<Record<string, unknown>>;

export async function readActionSignals(request: Request): Promise<ActionSignals> {
	const result = await ds.readSignals(request);
	if (!result.success || !isRecord(result.signals)) {
		throw new ActionInputError("Malformed Datastar signals.");
	}
	return result.signals;
}

export function stringField(signals: ActionSignals, field: string): string {
	const value = signals[field];
	if (typeof value !== "string") {
		throw new ActionInputError(`Missing or invalid ${field}.`);
	}
	return value;
}

export function requiredString(signals: ActionSignals, field: string): string {
	const value = stringField(signals, field);
	if (value.trim() === "") {
		throw new ActionInputError(`Missing or invalid ${field}.`);
	}
	return value;
}

export function optionalString(
	signals: ActionSignals,
	field: string,
): string | undefined {
	const value = signals[field];
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") {
		throw new ActionInputError(`Invalid ${field}.`);
	}
	return value;
}

export function booleanField(
	signals: ActionSignals,
	field: string,
	options: { optional?: boolean } = {},
): boolean {
	const value = signals[field];
	if (value === undefined && options.optional) return false;
	if (typeof value !== "boolean") {
		throw new ActionInputError(`Invalid ${field}.`);
	}
	return value;
}

export function enumField<const T extends readonly string[]>(
	signals: ActionSignals,
	field: string,
	values: T,
): T[number] {
	const value = signals[field];
	if (typeof value !== "string" || !values.includes(value)) {
		throw new ActionInputError(`Invalid ${field}.`);
	}
	return value as T[number];
}
