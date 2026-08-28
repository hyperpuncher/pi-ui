import {
	appendFile,
	mkdir as makeDirectory,
	readdir as readDirectory,
	rm,
	stat as fileStat,
	symlink as createSymbolicLink,
	utimes,
} from "node:fs/promises";

export function mkdir(
	path: string | URL,
	options?: { recursive?: boolean },
): Promise<string | undefined> {
	return makeDirectory(path, options);
}

export function readDir(path: string | URL) {
	return readDirectory(path, { withFileTypes: true });
}

export function readTextFile(path: string | URL): Promise<string> {
	return Bun.file(path).text();
}

export function remove(
	path: string | URL,
	options?: { recursive?: boolean },
): Promise<void> {
	return rm(path, { recursive: options?.recursive ?? false });
}

export function stat(path: string | URL) {
	return fileStat(path);
}

export function symlink(target: string, path: string): Promise<void> {
	return createSymbolicLink(target, path);
}

export function utime(
	path: string | URL,
	accessed: Date | number,
	modified: Date | number,
): Promise<void> {
	return utimes(path, accessed, modified);
}

export function writeFile(
	path: string | URL,
	contents: Blob | ArrayBuffer | Uint8Array,
): Promise<number> {
	return Bun.write(path, contents);
}

export function writeTextFile(
	path: string | URL,
	contents: string,
	options?: { append?: boolean },
): Promise<number | void> {
	if (options?.append) return appendFile(path, contents);
	return Bun.write(path, contents);
}

export function isNotFoundError(cause: unknown): boolean {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export function notFoundError(message: string): Error {
	return Object.assign(new Error(message), { code: "ENOENT" });
}
