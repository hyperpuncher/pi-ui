import { test } from "bun:test";

import { attachmentFileKind } from "#static/app/attachment-file.js";
import { assertEquals, assertRejects } from "#testing/assertions";

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
	canSubmit,
	composePrompt,
	convertAvifToJpeg,
	extractTransferredFilePaths,
	fileWithDetectedMimeType,
	hasAttachments,
	insert,
	isAvifImageFile,
	isHeicImageFile,
	jpegFileName,
	submit,
	syncSession,
} = await import("#static/app/file-transfer.js");

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
	assertEquals(fileWithDetectedMimeType(detected, null).type, "");
	assertEquals(fileWithDetectedMimeType(detected, undefined).type, "image/png");
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

test("AVIF conversion paints before requesting JPEG encoding and releases the bitmap", async () => {
	const originalBitmap = Object.getOwnPropertyDescriptor(
		globalThis,
		"createImageBitmap",
	);
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	let closed = false;
	const bitmap = {
		width: 3200,
		height: 1800,
		close: () => {
			closed = true;
		},
	};
	const painted: string[] = [];
	const context = {
		fillStyle: "",
		fillRect: (...bounds: number[]) => {
			assertEquals(context.fillStyle, "white");
			assertEquals(bounds, [0, 0, 3200, 1800]);
			painted.push("background");
		},
		drawImage: (image: typeof bitmap, ...bounds: number[]) => {
			assertEquals(image === bitmap, true);
			assertEquals(bounds, [0, 0, 3200, 1800]);
			painted.push("image");
		},
	};
	const canvas = {
		width: 0,
		height: 0,
		getContext: (kind: string) => (kind === "2d" ? context : null),
		toBlob: (callback: (blob: Blob) => void, type: string) => {
			assertEquals(painted, ["background", "image"]);
			assertEquals(type, "image/jpeg");
			callback(new Blob(["jpeg"], { type }));
		},
	};
	Object.defineProperty(globalThis, "createImageBitmap", {
		configurable: true,
		value: () => Promise.resolve(bitmap),
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { createElement: (tag: string) => (tag === "canvas" ? canvas : null) },
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

function createAttachmentDomHarness() {
	const originals = Object.getOwnPropertyDescriptors(globalThis);
	class FakeElement {
		children: FakeElement[] = [];
		className = "";
		dataset: Record<string, string> = {};
		hidden = false;
		id = "";
		textContent = "";
		type = "";
		attrs = new Map<string, string>();
		append(...nodes: FakeElement[]) {
			this.children.push(...nodes);
		}
		replaceChildren(...nodes: FakeElement[]) {
			this.children = [...nodes];
		}
		setAttribute(name: string, value: string) {
			this.attrs.set(name, value);
		}
		addEventListener() {}
		dispatchEvent() {
			return true;
		}
	}
	class FakeButton extends FakeElement {
		disabled = true;
	}
	class FakeTextarea extends FakeElement {
		value = "";
		focus() {}
		before() {}
	}
	class FakeParagraph extends FakeElement {}

	const tray = new FakeElement();
	tray.id = "prompt-attachments";
	tray.hidden = true;
	const promptBox = new FakeElement();
	promptBox.id = "prompt-box";
	const input = new FakeTextarea();
	input.id = "prompt-input";
	const sendButton = new FakeButton();
	const errorEl = new FakeParagraph();
	errorEl.id = "file-transfer-error";
	errorEl.hidden = true;
	const restoredDrafts: Array<{ key: string; text: string }> = [];

	const elementsById = new Map<string, FakeElement>([
		["prompt-attachments", tray],
		["prompt-box", promptBox],
		["prompt-input", input],
		["file-transfer-error", errorEl],
	]);

	Object.defineProperties(globalThis, {
		HTMLElement: { configurable: true, value: FakeElement },
		HTMLButtonElement: { configurable: true, value: FakeButton },
		HTMLTextAreaElement: { configurable: true, value: FakeTextarea },
		HTMLParagraphElement: { configurable: true, value: FakeParagraph },
		document: {
			configurable: true,
			value: {
				body: { dataset: { filesImportEndpoint: "/files/import" } },
				getElementById: (id: string) => elementsById.get(id) ?? null,
				querySelector: (selector: string) =>
					selector === "[data-send-trigger]" ? sendButton : null,
				createElement: (tag: string) =>
					tag === "button" ? new FakeButton() : new FakeElement(),
				createElementNS: () => new FakeElement(),
			},
		},
		window: {
			configurable: true,
			value: {
				piUi: {
					promptDrafts: {
						restore(key: string, text: string) {
							restoredDrafts.push({ key, text });
						},
					},
				},
			},
		},
	});

	return {
		tray,
		sendButton,
		restoredDrafts,
		restore() {
			for (const key of [
				"HTMLElement",
				"HTMLButtonElement",
				"HTMLTextAreaElement",
				"HTMLParagraphElement",
				"document",
				"window",
				"fetch",
			]) {
				restoreGlobal(key, originals[key]);
			}
		},
	};
}

test("attachments stay separate per session and update submit readiness", async () => {
	const harness = createAttachmentDomHarness();
	try {
		syncSession("session-a");
		await insert({ files: [{ path: "/tmp/a.txt", name: "a.txt" }] });
		assertEquals(hasAttachments(), true);
		assertEquals(canSubmit(""), true);
		assertEquals(harness.tray.hidden, false);
		assertEquals(harness.tray.children.length, 1);
		assertEquals(harness.sendButton.disabled, false);

		syncSession("session-b");
		assertEquals(hasAttachments(), false);
		assertEquals(canSubmit(""), false);
		assertEquals(harness.tray.hidden, true);
		assertEquals(harness.tray.children.length, 0);
		assertEquals(harness.sendButton.disabled, true);

		await insert({ files: [{ path: "/tmp/b.txt", name: "b.txt" }] });
		assertEquals(hasAttachments(), true);
		assertEquals(harness.tray.children.length, 1);

		syncSession("session-a");
		assertEquals(hasAttachments(), true);
		assertEquals(harness.tray.hidden, false);
		assertEquals(harness.tray.children.length, 1);
		assertEquals(harness.tray.children[0]?.attrs.get("aria-label"), "Remove a.txt");
	} finally {
		harness.restore();
	}
});

test("in-flight uploads and submits stay scoped to the session that started them", async () => {
	const harness = createAttachmentDomHarness();
	let resolveImport!: (response: Response) => void;
	let resolveSubmit!: (response: Response) => void;
	let importStartedResolve!: () => void;
	const importStarted = new Promise<void>((resolve) => {
		importStartedResolve = resolve;
	});
	let submittedPrompt = "";

	Object.defineProperty(globalThis, "fetch", {
		configurable: true,
		value: (url: string, init?: RequestInit) => {
			if (url === "/files/import") {
				importStartedResolve();
				return new Promise<Response>((resolve) => {
					resolveImport = resolve;
				});
			}
			const body = init?.body;
			if (body instanceof FormData)
				submittedPrompt = String(body.get("prompt") ?? "");
			return new Promise<Response>((resolve) => {
				resolveSubmit = resolve;
			});
		},
	});

	try {
		syncSession("upload-a");
		const uploadPromise = insert([
			new File(["hello"], "note.txt", { type: "text/plain" }),
		]);
		await importStarted;
		syncSession("upload-b");
		resolveImport(
			new Response(
				JSON.stringify({
					imports: [{ path: "/tmp/imported-note.txt", mimeType: null }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		await uploadPromise;

		assertEquals(hasAttachments(), false);
		assertEquals(harness.tray.hidden, true);

		syncSession("upload-a");
		assertEquals(hasAttachments(), true);
		assertEquals(harness.tray.children.length, 1);

		const submitPromise = submit("/prompt", "check note");
		syncSession("upload-b");
		await insert({ files: [{ path: "/tmp/b-only.txt", name: "b-only.txt" }] });
		resolveSubmit(new Response("", { status: 200 }));
		assertEquals(await submitPromise, true);
		assertEquals(submittedPrompt, "@/tmp/imported-note.txt\ncheck note");

		assertEquals(hasAttachments(), true);
		assertEquals(
			harness.tray.children[0]?.attrs.get("aria-label"),
			"Remove b-only.txt",
		);
		syncSession("upload-a");
		assertEquals(hasAttachments(), false);

		await insert({ files: [{ path: "/tmp/retry.txt", name: "retry.txt" }] });
		const failedSubmit = submit("/prompt", "retry prompt");
		syncSession("upload-b");
		resolveSubmit(new Response("error", { status: 500 }));
		assertEquals(await failedSubmit, false);
		assertEquals(harness.restoredDrafts, [{ key: "upload-a", text: "retry prompt" }]);
		syncSession("upload-a");
		assertEquals(hasAttachments(), true);
	} finally {
		harness.restore();
	}
});
