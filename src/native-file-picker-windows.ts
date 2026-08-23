import { dirname } from "@std/path";

import { appCachePath } from "./utils/app-cache.ts";

const pickerSource = new URL(
	"../static/native/windows-folder-picker.exe",
	import.meta.url,
);
let pickerExecutable: Promise<string> | undefined;

export async function windowsDirectoryPickerCommand(): Promise<{
	command: string;
	args: string[];
}> {
	return {
		command: await (pickerExecutable ??= extractPickerExecutable()),
		args: [String(Deno.pid)],
	};
}

async function extractPickerExecutable(): Promise<string> {
	const contents = await Deno.readFile(pickerSource);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", contents));
	const version = Array.from(digest.slice(0, 8), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
	const path = appCachePath(`windows-folder-picker-${version}.exe`);
	await Deno.mkdir(dirname(path), { recursive: true });
	try {
		await Deno.writeFile(path, contents, { createNew: true });
	} catch (error) {
		if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
	}
	return path;
}
