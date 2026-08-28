import strictAssert from "node:assert/strict";

export function assert(value: unknown, message?: string): asserts value {
	strictAssert.ok(value, message ?? "");
}

export function assertAlmostEquals(
	actual: number,
	expected: number,
	tolerance = 1e-7,
	message?: string,
): void {
	strictAssert.ok(Math.abs(actual - expected) <= tolerance, message ?? "");
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
	strictAssert.deepStrictEqual(actual, expected, message ?? "");
}

export function assertExists<T>(
	value: T,
	message?: string,
): asserts value is NonNullable<T> {
	strictAssert.notEqual(value, null, message ?? "");
	strictAssert.notEqual(value, undefined, message ?? "");
}

export function assertFalse(value: unknown, message?: string): void {
	strictAssert.equal(value, false, message ?? "");
}

export function assertMatch(actual: string, expected: RegExp, message?: string): void {
	strictAssert.match(actual, expected, message ?? "");
}

export function assertNotEquals<T>(actual: T, expected: T, message?: string): void {
	strictAssert.notDeepStrictEqual(actual, expected, message ?? "");
}

export function assertNotMatch(actual: string, expected: RegExp, message?: string): void {
	strictAssert.doesNotMatch(actual, expected, message ?? "");
}

export async function assertRejects(
	operation: () => Promise<unknown>,
	ErrorClass?: new (...args: never[]) => Error,
	messageIncludes?: string,
	message?: string,
): Promise<Error> {
	let rejection: unknown;
	try {
		await operation();
	} catch (error) {
		rejection = error;
	}
	strictAssert.ok(rejection instanceof Error, message ?? "Expected promise to reject");
	if (ErrorClass) strictAssert.ok(rejection instanceof ErrorClass, message ?? "");
	if (messageIncludes) {
		strictAssert.ok(rejection.message.includes(messageIncludes), message ?? "");
	}
	return rejection;
}

export function assertStrictEquals<T>(actual: T, expected: T, message?: string): void {
	strictAssert.strictEqual(actual, expected, message ?? "");
}

export function assertStringIncludes(
	actual: string,
	expected: string,
	message?: string,
): void {
	strictAssert.ok(
		actual.includes(expected),
		message ?? `Expected output to include ${JSON.stringify(expected)}:\n${actual}`,
	);
}

export function assertStringExcludes(actual: string, expected: string): void {
	strictAssert.equal(
		actual.includes(expected),
		false,
		`Expected output not to include ${JSON.stringify(expected)}`,
	);
}

export function assertThrows(
	operation: () => unknown,
	ErrorClass?: new (...args: never[]) => Error,
	messageIncludes?: string,
	message?: string,
): Error {
	let thrown: unknown;
	try {
		operation();
	} catch (error) {
		thrown = error;
	}
	strictAssert.ok(thrown instanceof Error, message ?? "Expected function to throw");
	if (ErrorClass) strictAssert.ok(thrown instanceof ErrorClass, message ?? "");
	if (messageIncludes) {
		strictAssert.ok(thrown.message.includes(messageIncludes), message ?? "");
	}
	return thrown;
}
