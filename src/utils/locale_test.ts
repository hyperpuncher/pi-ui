import { assertEquals } from "@std/assert";

import { posixLocaleToBcp47 } from "./locale.ts";

Deno.test("POSIX locales normalize to valid BCP 47 language tags", () => {
	assertEquals(posixLocaleToBcp47(undefined), undefined);
	assertEquals(posixLocaleToBcp47("C"), undefined);
	assertEquals(posixLocaleToBcp47("C.UTF-8"), undefined);
	assertEquals(posixLocaleToBcp47("POSIX"), undefined);
	assertEquals(posixLocaleToBcp47("en_US.UTF-8"), "en-US");
	assertEquals(posixLocaleToBcp47("de_DE@euro"), "de-DE");
});
