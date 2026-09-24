import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import {
	builtinSlashCommandCatalog,
	isBuiltinCommandName,
	parseSlashCommand,
} from "./builtin-commands.ts";

test("parseSlashCommand splits the command name and trims the argument text", () => {
	assertEquals(parseSlashCommand("/model foo/bar"), { name: "model", args: "foo/bar" });
	assertEquals(parseSlashCommand("/Name   My Title  "), {
		name: "name",
		args: "My Title",
	});
	assertEquals(parseSlashCommand("/tree"), { name: "tree", args: "" });
	assertEquals(parseSlashCommand("/thinking  "), { name: "thinking", args: "" });
});

test("parseSlashCommand rejects text that isn't a slash command", () => {
	assertEquals(parseSlashCommand("hello world"), undefined);
	assertEquals(parseSlashCommand(""), undefined);
	assertEquals(parseSlashCommand("/"), undefined);
	assertEquals(parseSlashCommand("/  leading space name"), undefined);
});

test("parseSlashCommand keeps multi-word argument text intact, only trimming the ends", () => {
	assertEquals(parseSlashCommand("/export  /tmp/my session.html  "), {
		name: "export",
		args: "/tmp/my session.html",
	});
});

test("isBuiltinCommandName recognizes every catalogued built-in and nothing else", () => {
	for (const command of builtinSlashCommandCatalog) {
		assertEquals(isBuiltinCommandName(command.name), true);
	}
	assertEquals(isBuiltinCommandName("not-a-real-command"), false);
	assertEquals(isBuiltinCommandName("skill:foo"), false);
	assertEquals(isBuiltinCommandName(""), false);
});

test("builtinSlashCommandCatalog rows are all marked as system commands with a name and description", () => {
	assertEquals(builtinSlashCommandCatalog.length > 0, true);
	for (const command of builtinSlashCommandCatalog) {
		assertEquals(command.source, "system");
		assertEquals(command.name.length > 0, true);
		assertEquals(command.description.length > 0, true);
	}
	// No duplicate names — the catalog is a faithful, undiverged mirror of the SDK.
	const names = builtinSlashCommandCatalog.map((command) => command.name);
	assertEquals(names.length, new Set(names).size);
});
