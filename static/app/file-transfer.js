import { fileUriToPath } from "../file-uri.js";
import { closePickers } from "./pickers.js";
import { promptInput } from "./prompt.js";

const FILE_REFERENCE_TYPES = [
	"text/uri-list",
	"x-special/gnome-copied-files",
	"text/plain",
];
const MAX_TRANSFER_FILES = 10;
const MAX_TRANSFER_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSFER_TOTAL_BYTES = 50 * 1024 * 1024;
let dragDepth = 0;

export function hasFiles(data) {
	if (!data) return false;
	if (data.files?.length) return true;
	return [...data.types].some((type) => type === "Files" || type === "text/uri-list");
}

export async function pick() {
	showTransferError("");
	try {
		const endpoint = document.body.dataset.filesPickEndpoint;
		const response = await fetch(endpoint, { method: "POST" });
		if (!response.ok) throw new Error(`Native picker failed: ${response.status}`);
		const result = await response.json();
		if (Array.isArray(result.paths) && result.paths.length > 0) {
			insertFileReferences(result.paths);
		}
	} catch (error) {
		console.error(error);
		showTransferError(error?.message || "Could not open the native file picker.");
	}
}

export function enterDrag() {
	dragDepth += 1;
	return true;
}

export function leaveDrag() {
	dragDepth = Math.max(0, dragDepth - 1);
	return dragDepth > 0;
}

export function resetDrag() {
	dragDepth = 0;
}

export async function insert(data) {
	if (!data) return;
	showTransferError("");
	const paths = extractTransferredFilePaths(data);
	if (paths.length > 0) {
		insertFileReferences(paths);
		return;
	}
	const files = transferredFiles(data);
	if (files.length === 0) return;
	const validationError = validateTransferredFiles(files);
	if (validationError) {
		showTransferError(validationError);
		return;
	}
	const uploaded = await uploadTransferredFiles(files);
	if (uploaded.length > 0) insertFileReferences(uploaded);
}

export function extractTransferredFilePaths(data) {
	const references =
		typeof data.getData === "function"
			? FILE_REFERENCE_TYPES.flatMap((type) => data.getData(type).split(/\r?\n/))
			: [];
	for (const file of transferredFiles(data)) {
		references.push(file.path ?? "", file.webkitRelativePath ?? "");
	}
	return [...new Set(references.map(fileReferenceToPath).filter(Boolean))];
}

function transferredFiles(data) {
	if (data.files) return [...data.files];
	return typeof data[Symbol.iterator] === "function" ? [...data] : [];
}

function fileReferenceToPath(value) {
	const reference = value.trim();
	if (
		!reference ||
		reference.startsWith("#") ||
		reference === "copy" ||
		reference === "cut"
	) {
		return undefined;
	}
	const uriPath = fileUriToPath(reference);
	if (uriPath) return uriPath;
	if (reference.startsWith("/") || /^[A-Za-z]:[\\/]/.test(reference)) return reference;
	return undefined;
}

function validateTransferredFiles(files) {
	if (files.length > MAX_TRANSFER_FILES) {
		return `Attach at most ${MAX_TRANSFER_FILES} files at a time.`;
	}
	if (files.some((file) => file.size > MAX_TRANSFER_FILE_BYTES)) {
		return "Dropped or pasted files must be 20 MiB or smaller; use the Files button for larger files.";
	}
	const totalBytes = files.reduce((total, file) => total + file.size, 0);
	if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
		return "Dropped or pasted files must total 50 MiB or less.";
	}
}

async function uploadTransferredFiles(files) {
	const formData = new FormData();
	for (const file of files) formData.append("file", file, file.name || "pasted-file");
	try {
		const endpoint = document.body.dataset.filesImportEndpoint;
		const response = await fetch(endpoint, { method: "POST", body: formData });
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			showTransferError(
				typeof result.message === "string"
					? result.message
					: "Could not transfer the selected files.",
			);
			return [];
		}
		showTransferError("");
		return Array.isArray(result.paths) ? result.paths : [];
	} catch {
		showTransferError("Could not transfer the selected files.");
		return [];
	}
}

function showTransferError(message) {
	const input = promptInput();
	if (!input) return;
	let error = document.getElementById("file-transfer-error");
	if (!(error instanceof HTMLParagraphElement)) {
		error = document.createElement("p");
		error.id = "file-transfer-error";
		error.className = "text-destructive mb-1 px-1 text-xs";
		error.setAttribute("role", "alert");
		error.setAttribute("aria-live", "polite");
		input.before(error);
	}
	error.textContent = message;
	error.hidden = !message;
}

export function formatFileReferences(paths) {
	return `${paths.map((path) => `@${path}`).join("\n")}\n`;
}

function insertFileReferences(paths) {
	const input = promptInput();
	if (!input) return;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	const prefix = start > 0 && !/\s/.test(input.value[start - 1] ?? "") ? " " : "";
	const text = `${prefix}${formatFileReferences(paths)}`;
	input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
	const cursor = start + text.length;
	input.selectionStart = cursor;
	input.selectionEnd = cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	closePickers(true);
}
