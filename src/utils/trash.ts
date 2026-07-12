export async function moveToTrash(path: string): Promise<void> {
	const command = trashCommand(path);
	try {
		const output = await new Deno.Command(command.command, {
			args: command.args,
		}).output();
		if (!output.success) {
			const stderr = new TextDecoder().decode(output.stderr).trim();
			throw new Error(stderr || `Trash command failed with code ${output.code}`);
		}
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			await Deno.remove(path);
			return;
		}
		throw error;
	}
}

export function trashCommand(path: string): { command: string; args: string[] } {
	if (Deno.build.os === "darwin") {
		return {
			command: "osascript",
			args: [
				"-e",
				`tell application "Finder" to delete POSIX file ${JSON.stringify(path)}`,
			],
		};
	}
	if (Deno.build.os === "windows") {
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
