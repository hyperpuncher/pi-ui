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
let submitting = false;
let attachmentResizeObserver;
const attachments = [];

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
			addPathAttachments(result.paths);
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
		addPathAttachments(paths);
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
	for (let index = 0; index < uploaded.length; index += 1) {
		addAttachment({ path: uploaded[index], file: files[index] });
	}
}

export function hasAttachments() {
	return attachments.length > 0;
}

export function canSubmit(prompt) {
	return !submitting && (prompt.trim() !== "" || hasAttachments());
}

export async function submit(endpoint, prompt, streamingBehavior) {
	if (!canSubmit(prompt)) return false;
	const submittedAttachments = [...attachments];
	const submittedPrompt = composePrompt(
		prompt,
		submittedAttachments.map(({ path }) => path),
	);
	const formData = new FormData();
	formData.set("prompt", submittedPrompt);
	if (streamingBehavior) formData.set("streamingBehavior", streamingBehavior);
	for (const { file } of submittedAttachments) {
		if (file?.type.startsWith("image/"))
			formData.append("image", file, file.name || "pasted-image");
	}
	submitting = true;
	renderAttachments();
	try {
		const response = await fetch(endpoint, { method: "POST", body: formData });
		await response.text();
		if (!response.ok)
			throw new Error(`Prompt was not accepted (${response.status}).`);
		removeSubmittedAttachments(submittedAttachments);
		showTransferError("");
		return true;
	} catch (error) {
		showTransferError(error?.message || "Could not send the prompt.");
		return false;
	} finally {
		submitting = false;
		renderAttachments();
	}
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

export function composePrompt(prompt, paths) {
	const references = formatFileReferences(paths);
	return prompt.trim() ? `${references}${prompt}` : references.trimEnd();
}

function addPathAttachments(paths) {
	for (const path of paths) addAttachment({ path });
}

function addAttachment({ path, file }) {
	if (!path || attachments.some((attachment) => attachment.path === path)) return;
	attachments.push({
		path,
		file,
		previewUrl: file?.type.startsWith("image/")
			? URL.createObjectURL(file)
			: undefined,
	});
	renderAttachments();
	promptInput()?.focus();
	closePickers(true);
}

function removeSubmittedAttachments(submitted) {
	for (const attachment of submitted) {
		const index = attachments.indexOf(attachment);
		if (index < 0) continue;
		attachments.splice(index, 1);
		if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
	}
}

function removeAttachment(path) {
	const index = attachments.findIndex((attachment) => attachment.path === path);
	if (index < 0) return;
	const [attachment] = attachments.splice(index, 1);
	if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
	renderAttachments();
}

function renderAttachments() {
	const tray = document.getElementById("prompt-attachments");
	if (!(tray instanceof HTMLElement)) return;
	tray.replaceChildren(...attachments.map(renderAttachment));
	tray.hidden = attachments.length === 0;
	observeAttachmentTray(tray);
	updateLatestButtonOffset(tray);
	const send = document.querySelector("[data-send-trigger]");
	if (send instanceof HTMLButtonElement)
		send.disabled = !canSubmit(promptInput()?.value ?? "");
}

function renderAttachment(attachment) {
	const name = attachment.file?.name || displayName(attachment.path);
	if (attachment.previewUrl) {
		const item = document.createElement("button");
		item.type = "button";
		item.className =
			"group relative size-16 shrink-0 cursor-pointer overflow-visible rounded-md border bg-muted/40 p-0 shadow-sm";
		item.setAttribute("aria-label", `Remove ${name}`);
		item.addEventListener("click", () => removeAttachment(attachment.path));
		const preview = document.createElement("span");
		preview.className = "block size-full overflow-clip rounded-md";
		const image = document.createElement("img");
		image.className = "size-full object-cover";
		image.style.overflowClipMargin = "unset";
		image.src = attachment.previewUrl;
		image.alt = name;
		preview.append(image);
		item.append(preview, removeBadge());
		return item;
	}

	const item = document.createElement("button");
	item.type = "button";
	item.className =
		"group relative flex h-16 max-w-52 items-center gap-2 overflow-visible rounded-lg border bg-card p-2 pr-3 text-left text-card-foreground shadow-sm";
	item.setAttribute("aria-label", `Remove ${name}`);
	item.addEventListener("click", () => removeAttachment(attachment.path));
	const icon = document.createElement("span");
	icon.className =
		"grid size-11 shrink-0 place-items-center rounded-md border bg-muted font-mono text-[10px] text-muted-foreground";
	icon.textContent = fileExtension(displayName(attachment.path)) || "file";
	item.append(icon);
	const details = document.createElement("span");
	details.className = "min-w-0";
	const nameElement = document.createElement("span");
	nameElement.className = "block truncate text-xs font-medium";
	nameElement.textContent = name;
	details.append(nameElement);
	const meta = document.createElement("span");
	meta.className = "block truncate text-[10px] text-muted-foreground";
	meta.textContent = attachment.file ? formatBytes(attachment.file.size) : "local file";
	details.append(meta);
	item.append(details, removeBadge());
	return item;
}

function observeAttachmentTray(tray) {
	if (attachmentResizeObserver) return;
	attachmentResizeObserver = new ResizeObserver(() => updateLatestButtonOffset(tray));
	attachmentResizeObserver.observe(tray);
}

function updateLatestButtonOffset(tray) {
	const latest = document.getElementById("messages-latest");
	if (!(latest instanceof HTMLButtonElement)) return;
	latest.style.translate = tray.hidden ? "" : `0 -${tray.offsetHeight + 8}px`;
}

function removeBadge() {
	const badge = document.createElement("span");
	badge.className =
		"absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-primary bg-primary text-xs text-primary-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100";
	badge.textContent = "×";
	badge.setAttribute("aria-hidden", "true");
	return badge;
}

function displayName(path) {
	return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function fileExtension(name) {
	const extension = name.includes(".") ? name.split(".").at(-1) : "";
	return extension.slice(0, 4).toLowerCase();
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
