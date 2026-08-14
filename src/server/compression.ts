import { Readable } from "node:stream";
import {
	constants,
	createBrotliCompress,
	createGzip,
	createZstdCompress,
	type BrotliCompress,
	type Gzip,
	type ZstdCompress,
} from "node:zlib";

const streamEncodings = ["zstd", "br", "gzip"] as const;
const brotliFlushChunkSize = 4 * 1_024;

type StreamEncoding = (typeof streamEncodings)[number];
type Compressor = ZstdCompress | BrotliCompress | Gzip;

export function compressSseResponse(request: Request, response: Response): Response {
	if (
		!response.body ||
		response.headers.has("content-encoding") ||
		response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
			"text/event-stream"
	) {
		return response;
	}
	const encoding = preferredStreamEncoding(request.headers.get("accept-encoding"));
	if (!encoding) return response;

	const compressor = createCompressor(encoding);
	void pumpCompressedBody(response.body.getReader(), compressor, encoding);

	const headers = new Headers(response.headers);
	headers.set("content-encoding", encoding);
	headers.set("vary", appendHeaderValue(headers.get("vary"), "Accept-Encoding"));
	headers.delete("content-length");
	return new Response(Readable.toWeb(compressor), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function preferredStreamEncoding(
	acceptEncoding: string | null,
): StreamEncoding | undefined {
	if (!acceptEncoding) return undefined;
	const qualities = new Map<string, number>();
	for (const entry of acceptEncoding.split(",")) {
		const [rawName, ...parameters] = entry.trim().split(";");
		const name = rawName.toLowerCase();
		if (!name) continue;
		let quality = 1;
		for (const parameter of parameters) {
			const [key, value] = parameter.split("=", 2).map((part) => part.trim());
			if (key.toLowerCase() !== "q") continue;
			quality = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)
				? Number(value)
				: 0;
			break;
		}
		qualities.set(name, Math.max(qualities.get(name) ?? 0, quality));
	}
	const wildcard = qualities.get("*") ?? 0;
	let preferred: StreamEncoding | undefined;
	let preferredQuality = 0;
	for (const encoding of streamEncodings) {
		const quality = qualities.get(encoding) ?? wildcard;
		if (quality > preferredQuality) {
			preferred = encoding;
			preferredQuality = quality;
		}
	}
	return preferred;
}

function createCompressor(encoding: StreamEncoding): Compressor {
	switch (encoding) {
		case "zstd":
			return createZstdCompress();
		case "br":
			return createBrotliCompress();
		case "gzip":
			return createGzip();
	}
}

async function pumpCompressedBody(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	compressor: Compressor,
	encoding: StreamEncoding,
): Promise<void> {
	let sourceEnded = false;
	const cancelSource = () => {
		if (!sourceEnded) void reader.cancel().catch(() => {});
	};
	compressor.once("close", cancelSource);
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				sourceEnded = true;
				break;
			}
			// Deno's Node Brotli bridge only exposes 4 KiB per explicit flush.
			const chunkSize = encoding === "br" ? brotliFlushChunkSize : value.length;
			for (let offset = 0; offset < value.length; offset += chunkSize) {
				await write(compressor, value.subarray(offset, offset + chunkSize));
				await flush(compressor, encoding);
			}
		}
		if (!compressor.destroyed) await end(compressor);
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		if (!compressor.destroyed) {
			compressor.destroy(error instanceof Error ? error : new Error(String(error)));
		}
	} finally {
		compressor.off("close", cancelSource);
		reader.releaseLock();
	}
}

function write(compressor: Compressor, chunk: Uint8Array): Promise<void> {
	return new Promise((resolve, reject) => {
		compressor.write(chunk, (error) => (error ? reject(error) : resolve()));
	});
}

function flush(compressor: Compressor, encoding: StreamEncoding): Promise<void> {
	const operation = {
		zstd: constants.ZSTD_e_flush,
		br: constants.BROTLI_OPERATION_FLUSH,
		gzip: constants.Z_SYNC_FLUSH,
	}[encoding];
	return new Promise((resolve) => compressor.flush(operation, resolve));
}

function end(compressor: Compressor): Promise<void> {
	return new Promise((resolve) => compressor.end(resolve));
}

function appendHeaderValue(current: string | null, value: string): string {
	if (!current) return value;
	const values = current.split(",").map((entry) => entry.trim().toLowerCase());
	return values.includes("*") || values.includes(value.toLowerCase())
		? current
		: `${current}, ${value}`;
}
