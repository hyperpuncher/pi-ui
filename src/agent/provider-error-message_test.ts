import { assertEquals } from "@std/assert";

import { formatProviderErrorMessage } from "./provider-error-message.ts";

Deno.test("pretty prints a structured provider error without dropping fields", () => {
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

Deno.test("pretty prints nested provider errors without assuming their schema", () => {
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

Deno.test("preserves unstructured and malformed provider errors", () => {
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
