import { assertEquals } from "@std/assert";

import { attachmentFileKind } from "./attachment-file.js";
import {
	composePrompt,
	extractTransferredFilePaths,
	formatFileReferences,
} from "./file-transfer.js";

Deno.test("file references use one line per path and end with a newline", () => {
	assertEquals(
		formatFileReferences(["/tmp/one.txt", "/tmp/two.txt"]),
		"@/tmp/one.txt\n@/tmp/two.txt\n",
	);
});

Deno.test("attachment paths are composed separately from visible prompt editing", () => {
	assertEquals(
		composePrompt("review these", ["/tmp/one.txt", "/tmp/two.txt"]),
		"@/tmp/one.txt\n@/tmp/two.txt\nreview these",
	);
	assertEquals(composePrompt("", ["/tmp/one.txt"]), "@/tmp/one.txt");
});

Deno.test("transferred files use their original paths", () => {
	const values: Record<string, string> = {
		"text/uri-list": "# files\nfile:///tmp/one.txt\nfile:///tmp/two%20words.txt",
		"x-special/gnome-copied-files":
			"copy\nfile:///tmp/one.txt\nfile:///tmp/three.txt",
		"text/plain": "/tmp/four.txt\nnot-a-path",
	};

	assertEquals(
		extractTransferredFilePaths({
			getData: (type: string) => values[type] ?? "",
		}),
		["/tmp/one.txt", "/tmp/two words.txt", "/tmp/three.txt", "/tmp/four.txt"],
	);
});

Deno.test("attachment file kinds use MIME types and extensions", () => {
	assertEquals(attachmentFileKind("vadim.txt", "text/plain"), "text");
	assertEquals(attachmentFileKind("recording.ogg", "audio/ogg"), "audio");
	assertEquals(attachmentFileKind("source.ts", ""), "code");
	assertEquals(attachmentFileKind("bundle.zip", ""), "archive");
	assertEquals(attachmentFileKind("unknown.bin", ""), "file");
});

Deno.test("transferred files use a webview-provided path without reading bytes", () => {
	assertEquals(
		extractTransferredFilePaths({
			files: [{ path: "/tmp/large-model.bin", name: "large-model.bin" }],
		}),
		["/tmp/large-model.bin"],
	);
});
