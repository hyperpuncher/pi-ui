import { fileUriToPath } from "../file-uri.js";
import { attachmentFileIcons, attachmentFileKind } from "./attachment-file.js";
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
const AVIF_JPEG_QUALITY = 0.85;
let dragDepth = 0;
let submitting = false;
const attachments = [];

export function hasFiles(data) {
	if (!data) return false;
	if (data.files?.length) return true;
	return [...data.types].some((type) => type === "Files" || type === "text/uri-list");
}

export async function pick() {
	showTransferError("");
	if (!document.body.hasAttribute("data-native-file-picker")) {
		pickBrowserFiles();
		return;
	}
	try {
		const endpoint = document.body.dataset.filesPickEndpoint;
		const response = await fetch(endpoint, { method: "POST" });
		if (!response.ok) throw new Error(`Native picker failed: ${response.status}`);
		const result = await response.json();
		if (Array.isArray(result.paths) && result.paths.length > 0) {
			const unsupported = unsupportedImagePathError(result.paths);
			if (unsupported) {
				showTransferError(unsupported);
				return;
			}
			addPathAttachments(result.paths);
		}
	} catch (error) {
		console.error(error);
		showTransferError(error?.message || "Could not open the native file picker.");
	}
}

function pickBrowserFiles() {
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.addEventListener(
		"change",
		() => {
			if (input.files?.length) void insert(input.files);
		},
		{ once: true },
	);
	input.click();
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
	const transferred = transferredFiles(data);
	const needsImageHandling = transferred.some(
		(file) => isAvifImageFile(file) || isHeicImageFile(file),
	);
	const paths = extractTransferredFilePaths(data);
	if (paths.length > 0 && !needsImageHandling) {
		const unsupported = unsupportedImagePathError(paths);
		if (unsupported) {
			showTransferError(unsupported);
			return;
		}
		addPathAttachments(paths);
		return;
	}
	if (transferred.length === 0) return;
	const validationError = validateTransferredFiles(transferred);
	if (validationError) {
		showTransferError(validationError);
		return;
	}
	let files;
	try {
		files = await prepareTransferredImages(transferred);
	} catch (error) {
		console.error(error);
		showTransferError(error?.message || "Could not prepare the selected images.");
		return;
	}
	const preparedValidationError = validateTransferredFiles(files);
	if (preparedValidationError) {
		showTransferError(preparedValidationError);
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
	try {
		const response = await fetch(endpoint, { method: "POST", body: formData });
		await response.text();
		if (!response.ok)
			throw new Error(`Prompt was not accepted (${response.status}).`);
		removeSubmittedAttachments(submittedAttachments);
		showTransferError("");
		return true;
	} catch (error) {
		restoreSubmittedPrompt(prompt);
		showTransferError(error?.message || "Could not send the prompt.");
		return false;
	} finally {
		submitting = false;
		document
			.getElementById("prompt-box")
			?.dispatchEvent(
				new CustomEvent("pi-ui-prompt-submit-finished", { bubbles: true }),
			);
		renderAttachments();
	}
}

export function extractTransferredFilePaths(data) {
	const references =
		"getData" in data
			? FILE_REFERENCE_TYPES.flatMap((type) => data.getData(type).split(/\r?\n/))
			: [];
	for (const file of transferredFiles(data)) {
		references.push(file.path ?? "", file.webkitRelativePath ?? "");
	}
	return [...new Set(references.map(fileReferenceToPath).filter(Boolean))];
}

function transferredFiles(data) {
	if (data.files) return [...data.files];
	return Array.from(data);
}

export function isAvifImageFile(file) {
	return file.type?.toLowerCase() === "image/avif" || /\.avif$/i.test(file.name ?? "");
}

export function isHeicImageFile(file) {
	return (
		/^(?:image\/)?hei[cf]$/i.test(file.type ?? "") ||
		/\.hei[cf]$/i.test(file.name ?? "")
	);
}

export function jpegFileName(name) {
	return /\.avif$/i.test(name)
		? name.replace(/\.avif$/i, ".jpg")
		: `${name || "image"}.jpg`;
}

async function prepareTransferredImages(files) {
	const prepared = [];
	for (const file of files) {
		if (isHeicImageFile(file)) {
			throw new Error(
				"HEIC and HEIF images are not supported. Convert them to JPEG or PNG first.",
			);
		}
		prepared.push(isAvifImageFile(file) ? await convertAvifToJpeg(file) : file);
	}
	return prepared;
}

export async function convertAvifToJpeg(file) {
	let bitmap;
	try {
		bitmap = await createImageBitmap(file);
		const canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas image conversion is unavailable.");
		context.fillStyle = "white";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise((resolve, reject) => {
			canvas.toBlob(
				(result) =>
					result ? resolve(result) : reject(new Error("JPEG encoding failed.")),
				"image/jpeg",
				AVIF_JPEG_QUALITY,
			);
		});
		return new File([blob], jpegFileName(file.name), {
			type: "image/jpeg",
			lastModified: file.lastModified,
		});
	} catch (error) {
		throw new Error(`Could not convert ${file.name || "the AVIF image"} to JPEG.`, {
			cause: error,
		});
	} finally {
		bitmap?.close();
	}
}

function unsupportedImagePathError(paths) {
	if (paths.some((path) => /\.hei[cf]$/i.test(path))) {
		return "HEIC and HEIF images are not supported. Convert them to JPEG or PNG first.";
	}
	if (paths.some((path) => /\.avif$/i.test(path))) {
		return "AVIF images must be dropped, pasted, or selected with the browser file picker so they can be converted.";
	}
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
				result.message?.constructor === String
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

function restoreSubmittedPrompt(prompt) {
	const input = promptInput();
	if (!input || input.value !== "" || !prompt) return;
	input.value = prompt;
	input.dispatchEvent(new Event("input", { bubbles: true }));
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
	const extension = fileExtension(name);
	const kind = attachmentFileKind(name, attachment.file?.type);
	const icon = document.createElement("span");
	icon.className =
		"flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border bg-muted text-muted-foreground";
	icon.dataset.fileKind = kind;
	icon.append(attachmentFileIcon(kind));
	if (extension) {
		const extensionElement = document.createElement("span");
		extensionElement.className = "font-mono text-[9px] leading-none uppercase";
		extensionElement.textContent = extension;
		icon.append(extensionElement);
	}
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

function attachmentFileIcon(kind) {
	const namespace = "http://www.w3.org/2000/svg";
	const icon = attachmentFileIcons[kind] ?? attachmentFileIcons.file;
	const svg = document.createElementNS(namespace, "svg");
	svg.setAttribute("class", "size-5");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("stroke-width", "2");
	svg.setAttribute("aria-hidden", "true");
	for (const data of icon.paths) {
		const path = document.createElementNS(namespace, "path");
		path.setAttribute("d", data);
		svg.append(path);
	}
	if (icon.circle) {
		const circle = document.createElementNS(namespace, "circle");
		for (const [name, value] of Object.entries(icon.circle)) {
			circle.setAttribute(name, String(value));
		}
		svg.append(circle);
	}
	return svg;
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
