import { assertFalse } from "@std/assert";

export function assertStringExcludes(actual: string, expected: string): void {
	assertFalse(
		actual.includes(expected),
		`Expected output not to include ${JSON.stringify(expected)}`,
	);
}
