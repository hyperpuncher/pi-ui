import { outputCommand } from "./command.ts";
import { isNotFound } from "./fs-errors.ts";
import { operatingSystem } from "./platform.ts";

type TrashCommand = { command: string; args: string[] };

export async function moveToTrash(path: string): Promise<void> {
	const command = trashCommand(path);
	try {
		const output = await outputCommand(command.command, { args: command.args });
		if (!output.success) {
			const stderr = new TextDecoder().decode(output.stderr).trim();
			throw new Error(stderr || `Trash command failed with code ${output.code}`);
		}
	} catch (error) {
		if (isNotFound(error)) {
			await Bun.file(path).delete();
			return;
		}
		throw error;
	}
}

function trashCommand(path: string): TrashCommand {
	if (operatingSystem === "darwin") {
		return {
			command: "osascript",
			args: [
				"-e",
				`tell application "Finder" to delete POSIX file ${JSON.stringify(path)}`,
			],
		};
	}
	if (operatingSystem === "windows") {
		return {
			command: "powershell",
			args: [
				"-NoProfile",
				"-Command",
				`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${JSON.stringify(path)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
			],
		};
	}
	return { command: "trash", args: [path] };
}
