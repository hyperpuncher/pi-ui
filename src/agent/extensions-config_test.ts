import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import {
	applyExtensionsHostMarker,
	defaultExtensionsConfig,
	extensionsHostMarkerEnvVar,
	parseExtensionsConfig,
} from "./extensions-config.ts";

test('extensions config defaults to "tui" and rejects unknown values', () => {
	assertEquals(defaultExtensionsConfig, { mode: "tui" });
	assertEquals(parseExtensionsConfig(undefined), { mode: "tui" });
	assertEquals(parseExtensionsConfig(null as unknown as undefined), { mode: "tui" });
	assertEquals(parseExtensionsConfig({}), { mode: "tui" });
	assertEquals(parseExtensionsConfig({ mode: "not-a-mode" }), { mode: "tui" });
	assertEquals(parseExtensionsConfig({ mode: 5 as unknown as string }), {
		mode: "tui",
	});
	assertEquals(parseExtensionsConfig({ mode: "tui" }), { mode: "tui" });
	assertEquals(parseExtensionsConfig({ mode: "rpc" }), { mode: "rpc" });
});

test('the host marker is set only for "tui" mode, and only once needed', () => {
	const original = process.env[extensionsHostMarkerEnvVar];
	try {
		delete process.env[extensionsHostMarkerEnvVar];
		applyExtensionsHostMarker({ mode: "rpc" });
		assertEquals(process.env[extensionsHostMarkerEnvVar], undefined);

		applyExtensionsHostMarker({ mode: "tui" });
		assertEquals(process.env[extensionsHostMarkerEnvVar], "1");
	} finally {
		if (original === undefined) delete process.env[extensionsHostMarkerEnvVar];
		else process.env[extensionsHostMarkerEnvVar] = original;
	}
});
