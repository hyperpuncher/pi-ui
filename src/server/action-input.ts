import type { Jsonifiable } from "@starfederation/datastar-sdk/types";
import { ServerSentEventGenerator as ds } from "@starfederation/datastar-sdk/web";
import Type from "typebox";
import { Compile } from "typebox/compile";

import { isBoolean, isRecord, isString } from "../utils/type-guards.ts";

export class ActionInputError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "ActionInputError";
	}
}

export type ActionSignals = Readonly<Record<string, Jsonifiable>>;

const nonnegativeIntegerValidator = Compile(Type.Integer({ minimum: 0 }));

export async function readActionSignals(request: Request): Promise<ActionSignals> {
	const result = await ds.readSignals(request);
	if (!result.success || !isRecord(result.signals)) {
		throw new ActionInputError("Malformed Datastar signals.");
	}
	return result.signals;
}

export function stringField(signals: ActionSignals, field: string): string {
	const value = signals[field];
	if (!isString(value)) {
		throw new ActionInputError(`Missing or invalid ${field}.`);
	}
	return value;
}

export function requiredString(
	signals: ActionSignals,
	field: string,
	options: { maxLength?: number } = {},
): string {
	const value = stringField(signals, field);
	if (value.trim() === "") {
		throw new ActionInputError(`Missing or invalid ${field}.`);
	}
	if (options.maxLength !== undefined && value.length > options.maxLength) {
		throw new ActionInputError(`${field} is too long.`);
	}
	return value;
}

/**
 * Reads an arbitrary JSON-compatible signal (already parsed by Datastar),
 * rejecting it once its serialized size exceeds {@link options.maxBytes}.
 * Used for untrusted, extension-shaped payloads (a PIUI action's `value`)
 * with no fixed field shape to validate structurally.
 */
export function jsonSizeField(
	signals: ActionSignals,
	field: string,
	options: { maxBytes: number },
): Jsonifiable | undefined {
	const value = signals[field];
	if (value === undefined) return undefined;
	let bytes: number;
	try {
		bytes = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
	} catch {
		throw new ActionInputError(`Invalid ${field}.`);
	}
	if (bytes > options.maxBytes) {
		throw new ActionInputError(`${field} is too large.`);
	}
	return value;
}

export function optionalString(
	signals: ActionSignals,
	field: string,
): string | undefined {
	const value = signals[field];
	if (value === undefined || value === null || value === "") return undefined;
	if (!isString(value)) {
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
	if (!isBoolean(value)) {
		throw new ActionInputError(`Invalid ${field}.`);
	}
	return value;
}

export function nonnegativeIntegerField(signals: ActionSignals, field: string): number {
	const value = signals[field];
	if (!nonnegativeIntegerValidator.Check(value)) {
		throw new ActionInputError(`Invalid ${field}.`);
	}
	return value;
}

/** Like {@link nonnegativeIntegerField}, but a missing/`null` field is `undefined`
 * rather than a validation error — for an optional hint a caller may not send. */
export function optionalNonnegativeIntegerField(
	signals: ActionSignals,
	field: string,
): number | undefined {
	const value = signals[field];
	if (value === undefined || value === null) return undefined;
	if (!nonnegativeIntegerValidator.Check(value)) {
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
	const matched = values.find((candidate) => candidate === value);
	if (matched === undefined) throw new ActionInputError(`Invalid ${field}.`);
	return matched;
}
