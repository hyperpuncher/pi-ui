// property values stay unknown until a field guard checks them.
export type JsonRecord = Record<string, unknown>;
export type JsonValue =
	boolean | number | string | null | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

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

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
	return isRecord(value);
}

export function asRecord<Value>(value: Value): (Value & JsonRecord) | undefined {
	return isRecord(value) ? value : undefined;
}
