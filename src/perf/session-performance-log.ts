import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { appCachePath } from "../utils/app-cache.ts";
import { isNotFound } from "../utils/fs-errors.ts";
import type { JsonValue } from "../utils/json-types.ts";

const maxLogBytes = 5 * 1024 * 1024;
let pendingWrite = Promise.resolve();

function sessionPerformanceLogPath(): string | undefined {
	const configured = process.env.PI_UI_PERF_FILE?.trim();
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
			await mkdir(dirname(path), { recursive: true });
			const size = await stat(path)
				.then((info) => info.size)
				.catch((error) => {
					if (isNotFound(error)) return 0;
					throw error;
				});
			if (size > 0 && size + bytes <= maxLogBytes) await appendFile(path, line);
			else await writeFile(path, line);
		})
		.catch((error) => console.warn("Failed to write session performance log", error));
}

export async function flushSessionPerformanceLog(): Promise<void> {
	await pendingWrite;
}
