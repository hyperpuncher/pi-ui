import { test } from "bun:test";

import { assertEquals, assertStringIncludes, assertThrows } from "#testing/assertions";

import {
	defaultServerHostname,
	defaultServerPort,
	parseServerOptions,
	serverUsage,
} from "./server-options.ts";

test("server options use loopback defaults", () => {
	assertEquals(parseServerOptions([]), {
		hostname: defaultServerHostname,
		port: defaultServerPort,
		help: false,
	});
});

test("server options read host and port from the environment", () => {
	assertEquals(parseServerOptions([], { host: "0.0.0.0", port: "8080" }), {
		hostname: "0.0.0.0",
		port: 8080,
		help: false,
	});
});

test("server flags override the environment", () => {
	assertEquals(
		parseServerOptions(["--host", "::1", "--port=9000"], {
			host: "0.0.0.0",
			port: "8080",
		}),
		{ hostname: "::1", port: 9000, help: false },
	);
});

test("server options support help", () => {
	assertEquals(parseServerOptions(["-h"]), {
		hostname: defaultServerHostname,
		port: defaultServerPort,
		help: true,
	});
	assertStringIncludes(serverUsage, "usage: pi-ui [options]");
	assertStringIncludes(serverUsage, "PI_UI_HOST");
	assertStringIncludes(serverUsage, "PI_UI_PORT");
});

test("server options reject invalid input", () => {
	assertThrows(() => parseServerOptions(["--host"]), Error, "non-empty hostname");
	assertThrows(() => parseServerOptions(["--port", "0"]), Error, "1 to 65535");
	assertThrows(() => parseServerOptions([], { port: "abc" }), Error, "1 to 65535");
	assertThrows(() => parseServerOptions(["-H", "localhost"]), Error, "unknown option");
	assertThrows(() => parseServerOptions(["-p", "1234"]), Error, "unknown option");
	assertThrows(() => parseServerOptions(["--unknown"]), Error, "unknown option");
});
