import * as path from "node:path";

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
		if (kind === "folder") await Deno.mkdir(target.resolved);
		else (await Deno.open(target.resolved, { createNew: true, write: true })).close();
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
		await Deno.lstat(destination.resolved);
		throw new WorkspaceFileError(409, "A file or folder already exists there.");
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
	try {
		await Deno.rename(source, destination.resolved);
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
		await Deno.remove(resolved, { recursive: true });
	} catch (error) {
		throw workspaceMutationError(error);
	}
}

export async function readWorkspaceFile(
	workspacePath: string,
	filePath: string,
): Promise<WorkspaceFile | WorkspaceUnavailableFile> {
	const resolved = await resolveWorkspaceFile(workspacePath, filePath);
	const info = await Deno.stat(resolved);
	if (!info.isFile) throw new WorkspaceFileError(400, "Path is not a file.");
	const path = normalizeRelativePath(filePath);
	if (info.size > maximumWorkspaceFileBytes) {
		return { message: "File is too large to view in pi-ui.", path, size: info.size };
	}
	const bytes = await Deno.readFile(resolved);
	let contents: string;
	try {
		contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return { message: "Only text files can be viewed.", path, size: info.size };
	}
	return { path, contents, revision: await fileRevision(bytes), size: info.size };
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
	const resolved = await resolveWorkspaceFile(workspacePath, filePath);
	const current = await Deno.stat(resolved);
	validateReadableFile(current);
	const currentBytes = await Deno.readFile(resolved);
	if ((await fileRevision(currentBytes)) !== expectedRevision) {
		throw new WorkspaceFileError(
			409,
			"The file changed on disk. Reopen it before saving.",
		);
	}
	await Deno.writeTextFile(resolved, contents);
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
		let entries: Deno.DirEntry[];
		try {
			entries = [];
			for await (const entry of Deno.readDir(current.path)) entries.push(entry);
		} catch {
			continue;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (paths.length >= maxEntryCount) return paths;
			if (
				entry.isSymlink ||
				ignoredDirectoryNames.has(entry.name) ||
				(!includeHiddenDirectories &&
					entry.isDirectory &&
					entry.name.startsWith("."))
			)
				continue;
			const entryPath = path.join(current.path, entry.name);
			if (entry.isDirectory) {
				paths.push(
					`${path.relative(workspacePath, entryPath).replaceAll("\\", "/")}/`,
				);
				directories.push({ depth: current.depth + 1, path: entryPath });
			} else if (entry.isFile) {
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
	let info: Deno.FileInfo;
	try {
		info = await Deno.lstat(target.resolved);
	} catch (error) {
		throw workspaceMutationError(error);
	}
	if (info.isSymlink) {
		throw new WorkspaceFileError(400, "Symbolic links cannot be changed.");
	}
	const resolved = await Deno.realPath(target.resolved);
	const workspace = await Deno.realPath(workspacePath);
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
	const workspace = await Deno.realPath(workspacePath);
	const candidate = path.resolve(workspace, normalized);
	if (candidate === workspace || !isWithinWorkspace(workspace, candidate)) {
		throw new WorkspaceFileError(400, "File is outside the workspace.");
	}
	let parent: string;
	try {
		parent = await Deno.realPath(path.dirname(candidate));
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

async function resolveWorkspaceFile(
	workspacePath: string,
	filePath: string,
): Promise<string> {
	const normalized = normalizeRelativePath(filePath);
	if (!normalized || normalized.includes("\0") || path.isAbsolute(normalized)) {
		throw new WorkspaceFileError(400, "Invalid workspace file path.");
	}
	const workspace = await Deno.realPath(workspacePath);
	const candidate = path.resolve(workspace, normalized);
	if (!isWithinWorkspace(workspace, candidate)) {
		throw new WorkspaceFileError(400, "File is outside the workspace.");
	}
	let resolved: string;
	try {
		resolved = await Deno.realPath(candidate);
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			throw new WorkspaceFileError(404, "File not found.");
		}
		throw error;
	}
	if (!isWithinWorkspace(workspace, resolved)) {
		throw new WorkspaceFileError(400, "File is outside the workspace.");
	}
	return resolved;
}

function workspaceMutationError(error: ErrorOptions["cause"]): WorkspaceFileError {
	if (error instanceof WorkspaceFileError) return error;
	if (error instanceof Deno.errors.AlreadyExists) {
		return new WorkspaceFileError(409, "A file or folder already exists there.");
	}
	if (error instanceof Deno.errors.NotFound) {
		return new WorkspaceFileError(404, "File or folder not found.");
	}
	if (error instanceof Deno.errors.PermissionDenied) {
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

function validateReadableFile(info: Deno.FileInfo): void {
	if (!info.isFile) throw new WorkspaceFileError(400, "Path is not a file.");
	if (info.size > maximumWorkspaceFileBytes) {
		throw new WorkspaceFileError(413, "File is too large to view in pi-ui.");
	}
}

async function fileRevision(contents: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(contents).buffer);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
