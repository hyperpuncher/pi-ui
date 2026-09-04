import { test } from "bun:test";

import { assertEquals, assertRejects } from "#testing/assertions";

import { attachmentFileExtension, attachmentFileKind } from "./attachment-file.js";

Object.defineProperty(globalThis, "ResizeObserver", {
	configurable: true,
	value: class {
		disconnect() {
			return undefined;
		}
		observe() {
			return undefined;
		}
	},
});

const {
	composePrompt,
	convertAvifToJpeg,
	extractTransferredFilePaths,
	fileWithDetectedMimeType,
	formatFileReferences,
	isAvifImageFile,
	isHeicImageFile,
	jpegFileName,
} = await import("./file-transfer.js");

test("file references use one line per path and end with a newline", () => {
	assertEquals(
		formatFileReferences(["/tmp/one.txt", "/tmp/two.txt"]),
		"@/tmp/one.txt\n@/tmp/two.txt\n",
	);
});

test("attachment paths are composed separately from visible prompt editing", () => {
	assertEquals(
		composePrompt("review these", ["/tmp/one.txt", "/tmp/two.txt"]),
		"@/tmp/one.txt\n@/tmp/two.txt\nreview these",
	);
	assertEquals(composePrompt("", ["/tmp/one.txt"]), "@/tmp/one.txt");
});

test("transferred files use their original paths", () => {
	const values = new Map(
		Object.entries({
			"text/uri-list": "# files\nfile:///tmp/one.txt\nfile:///tmp/two%20words.txt",
			"x-special/gnome-copied-files":
				"copy\nfile:///tmp/one.txt\nfile:///tmp/three.txt",
			"text/plain": "/tmp/four.txt\nnot-a-path",
		}),
	);

	assertEquals(
		extractTransferredFilePaths({
			getData: (type: string) => values.get(type) ?? "",
		}),
		["/tmp/one.txt", "/tmp/two words.txt", "/tmp/three.txt", "/tmp/four.txt"],
	);
});

test("attachment file kinds use MIME types and extensions", () => {
	assertEquals(attachmentFileExtension("archive.TAR.GZ"), "gz");
	assertEquals(attachmentFileExtension("README"), "");
	assertEquals(attachmentFileExtension("long.typescript"), "type");
	assertEquals(attachmentFileKind("vadim.txt", "text/plain"), "text");
	assertEquals(attachmentFileKind("recording.ogg", "audio/ogg"), "audio");
	assertEquals(attachmentFileKind("source.ts", ""), "code");
	assertEquals(attachmentFileKind("bundle.zip", ""), "archive");
	assertEquals(attachmentFileKind("unknown.bin", ""), "file");
});

test("server-detected MIME types replace untrusted browser metadata", async () => {
	const original = new File(["image"], "screenshot.bin", {
		type: "application/octet-stream",
		lastModified: 42,
	});
	const detected = fileWithDetectedMimeType(original, "image/png");
	assertEquals(detected.name, original.name);
	assertEquals(detected.type, "image/png");
	assertEquals(detected.lastModified, 42);
	assertEquals(await detected.text(), "image");
	assertEquals(fileWithDetectedMimeType(detected, "image/png"), detected);
	assertEquals(fileWithDetectedMimeType(detected, null).type, "");
	assertEquals(fileWithDetectedMimeType(detected, undefined), detected);
});

test("AVIF images are detected and renamed for JPEG conversion", () => {
	assertEquals(isAvifImageFile({ name: "photo.bin", type: "image/avif" }), true);
	assertEquals(isAvifImageFile({ name: "photo.AVIF", type: "" }), true);
	assertEquals(isAvifImageFile({ name: "photo.png", type: "image/png" }), false);
	assertEquals(jpegFileName("photo.AVIF"), "photo.jpg");
	assertEquals(jpegFileName("pasted-image"), "pasted-image.jpg");
});

test("HEIC and HEIF images are detected by MIME type or extension", () => {
	assertEquals(isHeicImageFile({ name: "photo.bin", type: "image/heic" }), true);
	assertEquals(isHeicImageFile({ name: "photo.HEIF", type: "" }), true);
	assertEquals(isHeicImageFile({ name: "photo.avif", type: "image/avif" }), false);
});

test("AVIF conversion produces a quality 85 JPEG and closes the bitmap", async () => {
	const originalBitmap = Object.getOwnPropertyDescriptor(
		globalThis,
		"createImageBitmap",
	);
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	let closed = false;
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({
			fillStyle: "",
			fillRect: () => undefined,
			drawImage: () => undefined,
		}),
		toBlob: (callback: (blob: Blob) => void, type: string, quality: number) => {
			assertEquals(type, "image/jpeg");
			assertEquals(quality, 0.85);
			callback(new Blob(["jpeg"], { type }));
		},
	};
	Object.defineProperty(globalThis, "createImageBitmap", {
		configurable: true,
		value: () =>
			Promise.resolve({
				width: 3200,
				height: 1800,
				close: () => {
					closed = true;
				},
			}),
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { createElement: () => canvas },
	});
	try {
		const converted = await convertAvifToJpeg(
			new File(["avif"], "screenshot.avif", {
				type: "image/avif",
				lastModified: 42,
			}),
		);
		assertEquals(converted.name, "screenshot.jpg");
		assertEquals(converted.type, "image/jpeg");
		assertEquals(converted.lastModified, 42);
		assertEquals(canvas.width, 3200);
		assertEquals(canvas.height, 1800);
		assertEquals(closed, true);
	} finally {
		restoreGlobal("createImageBitmap", originalBitmap);
		restoreGlobal("document", originalDocument);
	}
});

test("AVIF conversion reports decoding failures clearly", async () => {
	const original = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
	Object.defineProperty(globalThis, "createImageBitmap", {
		configurable: true,
		value: () => Promise.reject(new Error("decode failed")),
	});
	try {
		await assertRejects(
			() =>
				convertAvifToJpeg(
					new File(["broken"], "broken.avif", { type: "image/avif" }),
				),
			Error,
			"Could not convert broken.avif to JPEG.",
		);
	} finally {
		restoreGlobal("createImageBitmap", original);
	}
});

function restoreGlobal(name: string, descriptor?: PropertyDescriptor) {
	if (descriptor) {
		Object.defineProperty(globalThis, name, descriptor);
	} else {
		Reflect.deleteProperty(globalThis, name);
	}
}

test("transferred files use a webview-provided path without reading bytes", () => {
	assertEquals(
		extractTransferredFilePaths({
			files: [{ path: "/tmp/large-model.bin", name: "large-model.bin" }],
		}),
		["/tmp/large-model.bin"],
	);
});
