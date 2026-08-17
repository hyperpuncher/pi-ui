import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

const recordSchema = Type.Record(Type.String(), Type.Unknown());
const recordValidator = Compile(recordSchema);
const stringValidator = Compile(Type.String());
const numberValidator = Compile(Type.Number());
const booleanValidator = Compile(Type.Boolean());
export type JsonRecord = Static<typeof recordSchema>;
export function isString<Value>(value: Value): value is Value & string {
	return stringValidator.Check(value);
}

export function isNumber<Value>(value: Value): value is Value & number {
	return numberValidator.Check(value);
}

export function isBoolean<Value>(value: Value): value is Value & boolean {
	return booleanValidator.Check(value);
}

export function isRecord<Value>(value: Value): value is Value & JsonRecord {
	return recordValidator.Check(value);
}

export function asRecord<Value>(value: Value): (Value & JsonRecord) | undefined {
	return recordValidator.Check(value) ? value : undefined;
}
