import { assertEquals } from "@std/assert";

import {
	linuxDirectoryPickerCommands,
	linuxPickerCommands,
	parsePickedPaths,
} from "./native-file-picker.ts";

Deno.test("native picker output becomes absolute path references", () => {
	assertEquals(parsePickedPaths("/tmp/one.txt\n/tmp/two words.txt\n"), [
		"/tmp/one.txt",
		"/tmp/two words.txt",
	]);
	assertEquals(parsePickedPaths("C:\\one.txt\r\nD:\\two.txt"), [
		"C:\\one.txt",
		"D:\\two.txt",
	]);
});

Deno.test("Linux picker prefers the current desktop's native dialog", () => {
	assertEquals(
		linuxPickerCommands("KDE").map(({ command }) => command),
		["kdialog", "zenity"],
	);
	assertEquals(
		linuxPickerCommands("Hyprland").map(({ command }) => command),
		["zenity", "kdialog"],
	);
	assertEquals(
		linuxDirectoryPickerCommands("KDE").map(({ command }) => command),
		["kdialog", "zenity"],
	);
	assertEquals(linuxDirectoryPickerCommands("GNOME")[0]?.args, [
		"--file-selection",
		"--directory",
		"--title=Select workspace",
	]);
});
