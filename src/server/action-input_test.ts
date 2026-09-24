import { test } from "bun:test";

import {
	assertEquals,
	assertRejects,
	assertStringIncludes,
	assertThrows,
} from "#testing/assertions";

import { assertStringExcludes } from "../testing/assertions.ts";
import {
	ActionInputError,
	booleanField,
	enumField,
	jsonSizeField,
	optionalString,
	readActionSignals,
	requiredString,
} from "./action-input.ts";

test("action inputs reject malformed JSON instead of returning empty signals", async () => {
	await assertRejects(
		() => readActionSignals(actionRequest("{")),
		ActionInputError,
		"Malformed Datastar signals",
	);
});

test("action input readers validate required and optional field types", () => {
	assertEquals(requiredString({ path: " /tmp " }, "path"), " /tmp ");
	assertEquals(optionalString({}, "note"), undefined);
	assertEquals(booleanField({ enabled: true }, "enabled"), true);
	assertEquals(
		enumField({ direction: "forward" }, "direction", [
			"forward",
			"backward",
		] as const),
		"forward",
	);
	for (const callback of [
		() => requiredString({}, "path"),
		() => requiredString({ path: "  " }, "path"),
		() => requiredString({ path: false }, "path"),
		() => optionalString({ note: 1 }, "note"),
		() => booleanField({ enabled: "true" }, "enabled"),
		() =>
			enumField({ direction: "sideways" }, "direction", [
				"forward",
				"backward",
			] as const),
	]) {
		assertRejects(async () => callback(), ActionInputError);
	}
});

test("action input errors redact signal values including secrets", () => {
	const secret = "sk-secret-value";
	const error = assertThrows(
		() => requiredString({ authInput: { secret } }, "authInput"),
		ActionInputError,
		"authInput",
	);
	assertStringExcludes(error.message, secret);
	assertStringIncludes(error.message, "authInput");
});

test("requiredString enforces an optional max length", () => {
	assertEquals(requiredString({ id: "ab" }, "id", { maxLength: 5 }), "ab");
	assertRejects(
		async () => requiredString({ id: "abcdef" }, "id", { maxLength: 5 }),
		ActionInputError,
	);
});

test("jsonSizeField passes through small values and undefined", () => {
	assertEquals(jsonSizeField({ value: { a: 1 } }, "value", { maxBytes: 1024 }), {
		a: 1,
	});
	assertEquals(jsonSizeField({}, "value", { maxBytes: 1024 }), undefined);
});

test("jsonSizeField rejects a payload over the byte cap", async () => {
	await assertRejects(
		async () =>
			jsonSizeField({ value: { note: "x".repeat(2000) } }, "value", {
				maxBytes: 100,
			}),
		ActionInputError,
	);
});

function actionRequest(body: string): Request {
	return new Request("http://localhost/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
}
