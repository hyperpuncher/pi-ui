import { dirname, fromFileUrl, join } from "@std/path";

if (Deno.build.os === "windows") {
	const root = fromFileUrl(new URL("..", import.meta.url));
	const source = join(root, "native", "windows-folder-picker");
	const output = join(root, "static", "native", "windows-folder-picker.exe");
	const windowsDirectory = Deno.env.get("WINDIR") ?? "C:\\Windows";
	const compiler = join(
		windowsDirectory,
		"Microsoft.NET",
		"Framework64",
		"v4.0.30319",
		"csc.exe",
	);

	await Deno.mkdir(dirname(output), { recursive: true });
	const result = await new Deno.Command(compiler, {
		args: [
			"/nologo",
			"/optimize+",
			"/target:winexe",
			"/platform:x64",
			`/out:${output}`,
			`/win32icon:${join(root, "icons", "pi-logo.ico")}`,
			`/win32manifest:${join(source, "app.manifest")}`,
			join(source, "Program.cs"),
		],
	}).output();
	if (!result.success) {
		throw new Error(new TextDecoder().decode(result.stderr).trim());
	}
}
