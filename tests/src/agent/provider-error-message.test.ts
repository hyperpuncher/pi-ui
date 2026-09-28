import { test } from "bun:test";

import {
	formatProviderErrorMessage,
	isAbortErrorMessage,
} from "#src/agent/provider-error-message.ts";
import { assertEquals } from "#testing/assertions";

test("pretty prints a structured provider error without dropping fields", () => {
	assertEquals(
		formatProviderErrorMessage(
			'403: {"type":"RegionError","message":"This model requires explicit opt in."}',
		),
		`Error 403: {
	"type": "RegionError",
	"message": "This model requires explicit opt in."
}`,
	);
});

test("pretty prints nested provider errors without assuming their schema", () => {
	assertEquals(
		formatProviderErrorMessage(
			'429: {"error":{"message":"Rate limit exceeded","type":"rate_limit"}}',
		),
		`Error 429: {
	"error": {
		"message": "Rate limit exceeded",
		"type": "rate_limit"
	}
}`,
	);
});

test("recognizes the canonical abort error without hiding other failures", () => {
	assertEquals(isAbortErrorMessage("The operation was aborted."), true);
	assertEquals(isAbortErrorMessage(" the operation was aborted "), true);
	assertEquals(isAbortErrorMessage("Provider operation was aborted"), false);
	assertEquals(isAbortErrorMessage(), false);
});

test("preserves unstructured and malformed provider errors", () => {
	assertEquals(
		formatProviderErrorMessage("Provider unavailable"),
		"Error: Provider unavailable",
	);
	assertEquals(
		formatProviderErrorMessage('500: {"message":'),
		'Error: 500: {"message":',
	);
	assertEquals(formatProviderErrorMessage(), "Error: Unknown error");
});
