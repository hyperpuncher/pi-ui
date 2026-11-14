import {
	isBoolean,
	isJsonObject,
	isNumber,
	isString,
	type JsonObject,
	type JsonValue,
} from "#src/utils/type-guards.ts";

export class ActionInputError extends Error {
	readonly status = 400;

	constructor(message: string) {
		super(message);
		this.name = "ActionInputError";
	}
}

export type ActionSignals = Readonly<JsonObject>;

/** Datastar sends signals as a JSON body, or as the `datastar` query parameter for GET. */
export async function readActionSignals(request: Request): Promise<ActionSignals> {
	try {
		const signals: JsonValue =
			request.method === "GET"
				? JSON.parse(new URL(request.url).searchParams.get("datastar") ?? "")
				: await request.json();
		if (isJsonObject(signals)) return signals;
	} catch {
		// Fall through to the input error.
	}
	throw new ActionInputError("Malformed Datastar signals.");
}

export function stringField(signals: ActionSignals, field: string): string {
	const value = signals[field];
	if (!isString(value)) {
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
	if (!isNumber(value) || !Number.isInteger(value) || value < 0) {
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
