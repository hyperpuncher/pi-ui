import { test } from "bun:test";

import {
	formatProviderErrorMessage,
	isAbortErrorMessage,
} from "#src/agent/provider-error-message.ts";
import { assertEquals } from "#testing/assertions";

test("provider errors preserve the HTTP status and all JSON fields", () => {
	for (const [status, details] of [
		[403, { type: "RegionError", message: "This model requires explicit opt in." }],
		[429, { error: { message: "Rate limit exceeded", type: "rate_limit" } }],
	] as const) {
		const result = formatProviderErrorMessage(
			status + ": " + JSON.stringify(details),
		);
		const prefix = "Error " + status + ": ";
		assertEquals(result.startsWith(prefix), true);
		assertEquals(JSON.parse(result.slice(prefix.length)), details);
	}
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
