import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import {
	ActionInputError,
	booleanField,
	enumField,
	optionalString,
	readActionSignals,
	requiredString,
} from "./action-input.ts";

Deno.test("action inputs reject malformed JSON instead of returning empty signals", async () => {
	await assertRejects(
		() => readActionSignals(actionRequest("{")),
		ActionInputError,
		"Malformed Datastar signals",
	);
});

Deno.test("action input readers validate required and optional field types", () => {
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

Deno.test("action input errors redact signal values including secrets", () => {
	const secret = "sk-secret-value";
	try {
		requiredString({ authInput: { secret } }, "authInput");
		throw new Error("Expected validation to fail");
	} catch (error) {
		assertEquals(error instanceof ActionInputError, true);
		assertEquals(String(error).includes(secret), false);
		assertStringIncludes(String(error), "authInput");
	}
});

function actionRequest(body: string): Request {
	return new Request("http://localhost/action", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
}
