const decoder = new TextDecoder();

export async function pickNativeFilePaths(): Promise<string[]> {
	switch (Deno.build.os) {
		case "linux":
			return await pickLinuxFiles();
		case "darwin":
			return await runPicker({
				command: "osascript",
				args: [
					"-e",
					`set selectedFiles to choose file with prompt "Select files" with multiple selections allowed
set output to ""
repeat with selectedFile in selectedFiles
	set output to output & POSIX path of selectedFile & linefeed
end repeat
return output`,
				],
			});
		case "windows":
			return await runPicker({
				command: "powershell.exe",
				args: [
					"-NoProfile",
					"-STA",
					"-Command",
					`Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
	[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
	[Console]::Write(($dialog.FileNames -join [Environment]::NewLine))
}`,
				],
			});
		default:
			throw new Error(`Native file picker is not supported on ${Deno.build.os}.`);
	}
}

async function pickLinuxFiles(): Promise<string[]> {
	const commands = linuxPickerCommands(Deno.env.get("XDG_CURRENT_DESKTOP") ?? "");
	for (const command of commands) {
		try {
			return await runPicker(command);
		} catch (error) {
			if (error instanceof Deno.errors.NotFound) continue;
			throw error;
		}
	}
	throw new Error("No native file picker found. Install zenity or kdialog.");
}

export function linuxPickerCommands(desktop: string): PickerCommand[] {
	const zenity = {
		command: "zenity",
		args: [
			"--file-selection",
			"--multiple",
			"--separator=\n",
			"--title=Select files",
		],
	};
	const kdialog = {
		command: "kdialog",
		args: ["--getopenfilename", Deno.cwd(), "--multiple", "--separate-output"],
	};
	return /KDE/i.test(desktop) ? [kdialog, zenity] : [zenity, kdialog];
}

interface PickerCommand {
	command: string;
	args: string[];
}

async function runPicker(picker: PickerCommand): Promise<string[]> {
	const output = await new Deno.Command(picker.command, {
		args: picker.args,
		stdout: "piped",
		stderr: "piped",
	}).output();
	if (output.success) return parsePickedPaths(decoder.decode(output.stdout));
	if (output.code === 1) return [];
	const message = decoder.decode(output.stderr).trim();
	throw new Error(message || `${picker.command} exited with code ${output.code}`);
}

export function parsePickedPaths(output: string): string[] {
	return output.split(/\r?\n/).filter(Boolean);
}
