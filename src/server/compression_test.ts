import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createZstdDecompress } from "node:zlib";

import { assertEquals } from "@std/assert";

import { compressSseResponse, preferredStreamEncoding } from "./compression.ts";

Deno.test("stream compression negotiates zstd, brotli, and gzip quality", () => {
	assertEquals(preferredStreamEncoding("gzip, deflate, br, zstd"), "zstd");
	assertEquals(preferredStreamEncoding("gzip, deflate, br"), "br");
	assertEquals(preferredStreamEncoding("zstd;q=0.5, br;q=0.8"), "br");
	assertEquals(preferredStreamEncoding("br;q=0.5, gzip;q=0.9"), "gzip");
	assertEquals(preferredStreamEncoding("br;q=invalid, gzip"), "gzip");
	assertEquals(preferredStreamEncoding("gzip;q=0, *;q=0.4"), "zstd");
	assertEquals(preferredStreamEncoding("zstd;q=0, br;q=0, gzip;q=0"), undefined);
	assertEquals(preferredStreamEncoding(null), undefined);
});

Deno.test("compressed response cancellation reaches the SSE source", async () => {
	const cancelled = Promise.withResolvers<void>();
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("event: ready\ndata: ok\n\n"));
		},
		cancel() {
			cancelled.resolve();
		},
	});
	const response = compressSseResponse(
		new Request("http://localhost/stream", {
			headers: { "accept-encoding": "zstd" },
		}),
		new Response(source, {
			headers: { "content-type": "text/event-stream" },
		}),
	);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("compressed response has no body");
	await reader.read();
	await reader.cancel();
	await Promise.race([
		cancelled.promise,
		new Promise<never>((_resolve, reject) =>
			setTimeout(() => reject(new Error("source was not cancelled")), 500),
		),
	]);
});

Deno.test("SSE compression flushes events without closing the stream", async () => {
	const event = `event: datastar-patch-elements\ndata: elements <main>${"ready".repeat(
		30_000,
	)}</main>\n\n`;
	const eventBytes = new TextEncoder().encode(event);
	for (const encoding of ["zstd", "br", "gzip"] as const) {
		let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				sourceController = controller;
				controller.enqueue(eventBytes);
			},
		});
		const response = compressSseResponse(
			new Request("http://localhost/stream", {
				headers: { "accept-encoding": encoding },
			}),
			new Response(source, {
				headers: {
					"content-type": "text/event-stream",
					vary: "Datastar-Request",
				},
			}),
		);

		assertEquals(response.headers.get("content-encoding"), encoding);
		assertEquals(response.headers.get("vary"), "Datastar-Request, Accept-Encoding");
		if (!response.body) throw new Error("compressed response has no body");
		const reader = decompressedBody(response.body, encoding).getReader();
		const decoded = await Promise.race([
			readBytes(reader, eventBytes.length),
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error(`${encoding} did not flush`)), 500),
			),
		]);
		assertEquals(new TextDecoder().decode(decoded), event);
		await reader.cancel();
		sourceController?.close();
	}
});

function decompressedBody(
	body: ReadableStream<Uint8Array>,
	encoding: "zstd" | "br" | "gzip",
): ReadableStream<Uint8Array> {
	const decompressor =
		encoding === "zstd"
			? createZstdDecompress()
			: encoding === "br"
				? createBrotliDecompress()
				: createGunzip();
	Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(decompressor);
	return Readable.toWeb(decompressor) as unknown as ReadableStream<Uint8Array>;
}

async function readBytes(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	length: number,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total < length) {
		const result = await reader.read();
		if (result.done) throw new Error("compressed stream closed early");
		chunks.push(result.value);
		total += result.value.length;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
