import { fileUriToPath } from "../file-uri.js";
import { closePickers } from "./pickers.js";
import { promptInput } from "./prompt.js";

const MAX_TRANSFER_FILES = 10;
const MAX_TRANSFER_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSFER_TOTAL_BYTES = 50 * 1024 * 1024;
let dragDepth = 0;

export function hasFiles(data) {
	if (!data) return false;
	if (data.files?.length) return true;
	return [...data.types].some((type) => type === "Files" || type === "text/uri-list");
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
	const files = [...(data.files ?? [])];
	if (paths.length > 0) {
		insertFileReferences(paths);
		return;
	}
	if (files.length === 0) return;
	const validationError = validateTransferredFiles(files);
	if (validationError) {
		showTransferError(validationError);
		return;
	}
	const uploaded = await uploadTransferredFiles(files);
	if (uploaded.length > 0) insertFileReferences(uploaded);
}

function extractTransferredFilePaths(data) {
	return data
		.getData("text/uri-list")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map(fileUriToPath)
		.filter(Boolean);
}

function validateTransferredFiles(files) {
	if (files.length > MAX_TRANSFER_FILES) {
		return `Attach at most ${MAX_TRANSFER_FILES} files at a time.`;
	}
	if (files.some((file) => file.size > MAX_TRANSFER_FILE_BYTES)) {
		return "Each transferred file must be 20 MiB or smaller.";
	}
	const totalBytes = files.reduce((total, file) => total + file.size, 0);
	if (totalBytes > MAX_TRANSFER_TOTAL_BYTES) {
		return "Transferred files must total 50 MiB or less.";
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

function insertFileReferences(paths) {
	const input = promptInput();
	if (!input) return;
	const start = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? start;
	const prefix = start > 0 && !/\s/.test(input.value[start - 1] ?? "") ? " " : "";
	const suffix =
		end < input.value.length && !/\s/.test(input.value[end] ?? "") ? " " : "";
	const text = `${prefix}${paths.map((path) => `@${path}`).join(" ")}${suffix}`;
	input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
	const cursor = start + text.length;
	input.selectionStart = cursor;
	input.selectionEnd = cursor;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	input.focus();
	closePickers(true);
}
