import type { Stats } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import * as path from "node:path";

import { isAlreadyExists, isNotFound, isPermissionDenied } from "../utils/fs-errors.ts";

const maxDirectoryCount = 20_000;
const maxEntryCount = 20_000;
const maxFileDepth = 40;
export const maximumWorkspaceFileBytes = 2 * 1024 * 1024;
const ignoredDirectoryNames = new Set([
	".git",
	"node_modules",
	"__pycache__",
	".venv",
	"venv",
]);

export type WorkspaceEntryKind = "file" | "folder";

export type WorkspaceFile = {
	path: string;
	contents: string;
	revision: string;
	size: number;
};

export class WorkspaceFileError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "WorkspaceFileError";
	}
}

export async function listWorkspaceFiles(
	workspacePath: string,
	options: { includeHiddenDirectories?: boolean } = {},
): Promise<string[]> {
	const entries = await walkWorkspace(
		workspacePath,
		options.includeHiddenDirectories ?? true,
	);
	return entries.sort((left, right) => left.localeCompare(right));
}

export async function createWorkspaceEntry(
	workspacePath: string,
	entryPath: string,
	kind: WorkspaceEntryKind,
): Promise<{ path: string }> {
	const target = await resolveWorkspaceTarget(workspacePath, entryPath);
	try {
		if (kind === "folder") await mkdir(target.resolved);
		else await (await open(target.resolved, "wx")).close();
	} catch (error) {
		throw workspaceMutationError(error);
	}
	return { path: target.relative };
}

export async function moveWorkspaceEntry(
	workspacePath: string,
	entryPath: string,
	destinationPath: string,
): Promise<{ path: string }> {
	const source = await resolveWorkspaceEntry(workspacePath, entryPath);
	const destination = await resolveWorkspaceTarget(workspacePath, destinationPath);
	try {
		await lstat(destination.resolved);
		throw new WorkspaceFileError(409, "A file or folder already exists there.");
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
	try {
		await rename(source, destination.resolved);
	} catch (error) {
		throw workspaceMutationError(error);
	}
	return { path: destination.relative };
}

export async function removeWorkspaceEntry(
	workspacePath: string,
	entryPath: string,
): Promise<void> {
	const resolved = await resolveWorkspaceEntry(workspacePath, entryPath);
	try {
		await rm(resolved, { recursive: true });
	} catch (error) {
		throw workspaceMutationError(error);
	}
}

export async function readWorkspaceFile(
	workspacePath: string,
	filePath: string,
): Promise<WorkspaceFile | WorkspaceUnavailableFile> {
	const { path: resolved, size } = await resolveFile(workspacePath, filePath);
	const path = normalizeRelativePath(filePath);
	if (size > maximumWorkspaceFileBytes) {
		return { message: "File is too large to view in pi-ui.", path, size };
	}
	const bytes = await Bun.file(resolved).bytes();
	let contents: string;
	try {
		contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return { message: "Only text files can be viewed.", path, size };
	}
	return { path, contents, revision: await fileRevision(bytes), size };
}

export type WorkspaceUnavailableFile = {
	message: string;
	path: string;
	size: number;
};

export async function writeWorkspaceFile(
	workspacePath: string,
	filePath: string,
	contents: string,
	expectedRevision: string,
): Promise<WorkspaceFile> {
	if (new TextEncoder().encode(contents).byteLength > maximumWorkspaceFileBytes) {
		throw new WorkspaceFileError(413, "File is too large to save in pi-ui.");
	}
	const { path: resolved, size } = await resolveFile(workspacePath, filePath);
	if (size > maximumWorkspaceFileBytes) {
		throw new WorkspaceFileError(413, "File is too large to view in pi-ui.");
	}
	const currentBytes = await Bun.file(resolved).bytes();
	if ((await fileRevision(currentBytes)) !== expectedRevision) {
		throw new WorkspaceFileError(
			409,
			"The file changed on disk. Reopen it before saving.",
		);
	}
	await Bun.write(resolved, contents);
	const saved = await readWorkspaceFile(workspacePath, filePath);
	if ("message" in saved) throw new WorkspaceFileError(500, saved.message);
	return saved;
}

async function walkWorkspace(
	workspacePath: string,
	includeHiddenDirectories: boolean,
): Promise<string[]> {
	const paths: string[] = [];
	const directories = [{ depth: 0, path: workspacePath }];
	for (
		let index = 0;
		index < directories.length &&
		index < maxDirectoryCount &&
		paths.length < maxEntryCount;
		index += 1
	) {
		const current = directories[index];
		if (!current || current.depth > maxFileDepth) continue;
		let entries;
		try {
			entries = await readdir(current.path, { withFileTypes: true });
		} catch {
			continue;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (paths.length >= maxEntryCount) return paths;
			if (
				entry.isSymbolicLink() ||
				ignoredDirectoryNames.has(entry.name) ||
				(!includeHiddenDirectories &&
					entry.isDirectory() &&
					entry.name.startsWith("."))
			)
				continue;
			const entryPath = path.join(current.path, entry.name);
			if (entry.isDirectory()) {
				paths.push(
					`${path.relative(workspacePath, entryPath).replaceAll("\\", "/")}/`,
				);
				directories.push({ depth: current.depth + 1, path: entryPath });
			} else if (entry.isFile()) {
				paths.push(path.relative(workspacePath, entryPath).replaceAll("\\", "/"));
			}
		}
	}
	return paths;
}

async function resolveWorkspaceEntry(
	workspacePath: string,
	entryPath: string,
): Promise<string> {
	const target = await resolveWorkspaceTarget(workspacePath, entryPath);
	let info: Stats;
	try {
		info = await lstat(target.resolved);
	} catch (error) {
		throw workspaceMutationError(error);
	}
	if (info.isSymbolicLink()) {
		throw new WorkspaceFileError(400, "Symbolic links cannot be changed.");
	}
	const resolved = await realpath(target.resolved);
	const workspace = await realpath(workspacePath);
	if (!isWithinWorkspace(workspace, resolved)) {
		throw new WorkspaceFileError(400, "File is outside the workspace.");
	}
	return resolved;
}

async function resolveWorkspaceTarget(
	workspacePath: string,
	entryPath: string,
): Promise<{ relative: string; resolved: string }> {
	const normalized = normalizeRelativePath(entryPath).replace(/\/$/, "");
	if (!normalized || normalized.includes("\0") || path.isAbsolute(normalized)) {
		throw new WorkspaceFileError(400, "Invalid workspace file path.");
	}
	const workspace = await realpath(workspacePath);
	const candidate = path.resolve(workspace, normalized);
	if (candidate === workspace || !isWithinWorkspace(workspace, candidate)) {
		throw new WorkspaceFileError(400, "File is outside the workspace.");
	}
	let parent: string;
	try {
		parent = await realpath(path.dirname(candidate));
	} catch (error) {
		throw workspaceMutationError(error);
	}
	if (!isWithinWorkspace(workspace, parent)) {
		throw new WorkspaceFileError(400, "File is outside the workspace.");
	}
	return {
		relative: path.relative(workspace, candidate).replaceAll("\\", "/"),
		resolved: candidate,
	};
}

export async function resolveFile(
	workspacePath: string,
	filePath: string,
): Promise<{ path: string; size: number }> {
	const normalized = normalizeRelativePath(filePath);
	if (!normalized || normalized.includes("\0")) {
		throw new WorkspaceFileError(400, "Invalid file path.");
	}
	try {
		const resolved = await realpath(path.resolve(workspacePath, normalized));
		const info = await stat(resolved);
		if (!info.isFile()) throw new WorkspaceFileError(400, "Path is not a file.");
		return { path: resolved, size: info.size };
	} catch (error) {
		if (isNotFound(error)) {
			throw new WorkspaceFileError(404, "File not found.");
		}
		if (isPermissionDenied(error)) {
			throw new WorkspaceFileError(403, "Permission denied.");
		}
		throw error;
	}
}

function workspaceMutationError(error: ErrorOptions["cause"]): WorkspaceFileError {
	if (error instanceof WorkspaceFileError) return error;
	if (isAlreadyExists(error)) {
		return new WorkspaceFileError(409, "A file or folder already exists there.");
	}
	if (isNotFound(error)) {
		return new WorkspaceFileError(404, "File or folder not found.");
	}
	if (isPermissionDenied(error)) {
		return new WorkspaceFileError(403, "Permission denied.");
	}
	return new WorkspaceFileError(500, "Could not change the file or folder.");
}

function isWithinWorkspace(workspace: string, candidate: string): boolean {
	const relative = path.relative(workspace, candidate);
	return (
		relative !== ".." &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

function normalizeRelativePath(filePath: string): string {
	return filePath.replaceAll("\\", "/");
}

function fileRevision(contents: Uint8Array): Promise<string> {
	return Promise.resolve(new Bun.CryptoHasher("sha256").update(contents).digest("hex"));
}
