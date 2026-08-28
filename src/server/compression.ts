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

const encodings = ["zstd", "br", "gzip"] as const;
const brotliFlushChunkSize = 4 * 1_024;
const minimumCompressionSize = 1_024;

const compressibleApplicationTypes = new Set([
	"application/javascript",
	"application/json",
	"application/manifest+json",
	"application/xhtml+xml",
	"application/xml",
]);

export type ResponseEncoding = (typeof encodings)[number];
type Compressor = ZstdCompress | BrotliCompress | Gzip;

export function compressResponse(request: Request, response: Response): Response {
	if (!response.body || response.headers.has("content-encoding")) return response;

	const contentType = response.headers
		.get("content-type")
		?.split(";", 1)[0]
		.trim()
		.toLowerCase();
	if (contentType === "text/event-stream") {
		return compressSseResponse(request, response);
	}
	if (
		request.method === "HEAD" ||
		response.status === 206 ||
		response.headers.has("content-range") ||
		response.headers.get("cache-control")?.toLowerCase().includes("no-transform") ||
		!contentType ||
		!isCompressibleContentType(contentType)
	) {
		return response;
	}

	const contentLength = response.headers.get("content-length");
	if (contentLength && Number(contentLength) < minimumCompressionSize) return response;

	const headers = new Headers(response.headers);
	headers.set("vary", appendHeaderValue(headers.get("vary"), "Accept-Encoding"));
	const encoding = preferredResponseEncoding(request.headers.get("accept-encoding"));
	if (!encoding) return responseWithHeaders(response, headers);

	return compressedResponse(response, headers, encoding);
}

export function compressSseResponse(request: Request, response: Response): Response {
	if (
		!response.body ||
		response.headers.has("content-encoding") ||
		response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
			"text/event-stream"
	) {
		return response;
	}
	const encoding = preferredResponseEncoding(request.headers.get("accept-encoding"));
	if (!encoding) return response;

	const headers = new Headers(response.headers);
	headers.set("vary", appendHeaderValue(headers.get("vary"), "Accept-Encoding"));
	return compressedResponse(response, headers, encoding, encoding);
}

export function preferredResponseEncoding(
	acceptEncoding: string | null,
): ResponseEncoding | undefined {
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
	let preferred: ResponseEncoding | undefined;
	let preferredQuality = 0;
	for (const encoding of encodings) {
		const quality = qualities.get(encoding) ?? wildcard;
		if (quality > preferredQuality) {
			preferred = encoding;
			preferredQuality = quality;
		}
	}
	return preferred;
}

function compressedResponse(
	response: Response,
	headers: Headers,
	encoding: ResponseEncoding,
	flushEncoding?: ResponseEncoding,
): Response {
	const body = response.body;
	if (!body) return response;
	const compressor = createCompressor(encoding);
	void pumpCompressedBody(body.getReader(), compressor, flushEncoding);

	headers.set("content-encoding", encoding);
	headers.delete("content-length");
	const compressedBody: object = Readable.toWeb(compressor);
	// SAFETY: Node and Bun expose compatible byte-oriented Web stream contracts.
	return new Response(compressedBody as BodyInit, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function responseWithHeaders(response: Response, headers: Headers): Response {
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function isCompressibleContentType(contentType: string): boolean {
	return (
		contentType.startsWith("text/") ||
		contentType === "image/svg+xml" ||
		compressibleApplicationTypes.has(contentType) ||
		contentType.endsWith("+json") ||
		contentType.endsWith("+xml")
	);
}

function createCompressor(encoding: ResponseEncoding): Compressor {
	switch (encoding) {
		case "zstd":
			return createZstdCompress();
		case "br":
			return createBrotliCompress({
				params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
			});
		case "gzip":
			return createGzip();
	}
}

async function pumpCompressedBody(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	compressor: Compressor,
	flushEncoding?: ResponseEncoding,
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
			const chunkSize =
				flushEncoding === "br" ? brotliFlushChunkSize : value.length;
			for (let offset = 0; offset < value.length; offset += chunkSize) {
				await write(compressor, value.subarray(offset, offset + chunkSize));
				if (flushEncoding) await flush(compressor, flushEncoding);
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

function flush(compressor: Compressor, encoding: ResponseEncoding): Promise<void> {
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
