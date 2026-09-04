import type { Static, TRecord, TUnknown } from "typebox";

export type JsonRecord = Static<TRecord<string, TUnknown>>;

export function isString<Value>(value: Value): value is Value & string {
	return typeof value === "string";
}

export function isNumber<Value>(value: Value): value is Value & number {
	return typeof value === "number" && Number.isFinite(value);
}

export function isBoolean<Value>(value: Value): value is Value & boolean {
	return typeof value === "boolean";
}

export function isRecord<Value>(value: Value): value is Value & JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord<Value>(value: Value): (Value & JsonRecord) | undefined {
	return isRecord(value) ? value : undefined;
}
