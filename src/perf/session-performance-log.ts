import { dirname } from "@std/path";

import { appCachePath } from "../utils/app-cache.ts";
import type { JsonValue } from "../utils/json-types.ts";

const maxLogBytes = 5 * 1024 * 1024;
let pendingWrite = Promise.resolve();

export function sessionPerformanceLogPath(): string | undefined {
	const configured = Deno.env.get("PI_UI_PERF_FILE")?.trim();
	if (configured?.toLowerCase() === "off") return undefined;
	return configured || appCachePath("session-performance.jsonl");
}

export function appendSessionPerformanceRecord(record: JsonValue): void {
	const path = sessionPerformanceLogPath();
	if (!path) return;
	const line = `${JSON.stringify(record)}\n`;
	const bytes = new TextEncoder().encode(line).byteLength;
	pendingWrite = pendingWrite
		.catch(() => undefined)
		.then(async () => {
			await Deno.mkdir(dirname(path), { recursive: true });
			const size = await Deno.stat(path)
				.then((info) => info.size)
				.catch((error) => {
					if (error instanceof Deno.errors.NotFound) return 0;
					throw error;
				});
			await Deno.writeTextFile(path, line, {
				append: size > 0 && size + bytes <= maxLogBytes,
			});
		})
		.catch((error) => console.warn("Failed to write session performance log", error));
}

export async function flushSessionPerformanceLog(): Promise<void> {
	await pendingWrite;
}
