import {
	File,
	type FileOptions,
	getFiletypeFromFileName,
	preloadHighlighter,
	type SupportedLanguages,
} from "@pierre/diffs";
import type { Editor as PierreEditor } from "@pierre/diffs/edit";
import {
	type ContextMenuItem,
	type ContextMenuOpenContext,
	FileTree,
	type GitStatusEntry,
} from "@pierre/trees";

import { getPierreThemes } from "../pierre-theme.ts";
import { errorMessage } from "../utils/errors.ts";
import { workspaceTreeStyle, workspaceTreeUnsafeCss } from "../workspace-review-tree.ts";
import { requiredButton, requiredDialog, requiredElement, requiredInput } from "./dom.ts";
import {
	createWorkspaceFilesApi,
	type WorkspaceFileData,
	type WorkspaceFilePreviewData,
} from "./workspace-files-api.ts";
import { workspaceMenuButton } from "./workspace-tree-menu.ts";
import { createWorkspaceTreeExpansion } from "./workspace-tree.ts";

type WorkspaceFilesOptions = {
	endpoint: string;
	initialGitStatus: readonly GitStatusEntry[];
	initialWorkspacePath: string;
};

export function focusTreeHost(treeHost: HTMLElement): void {
	requestAnimationFrame(() => {
		const container = treeHost.querySelector("file-tree-container");
		const root = container?.shadowRoot?.querySelector<HTMLElement>('[role="tree"]');
		(root ?? treeHost).focus({ preventScroll: true });
	});
}

export function createWorkspaceFiles(options: WorkspaceFilesOptions) {
	const api = createWorkspaceFilesApi(options.endpoint);
	const treeHost = requiredElement("workspace-file-tree");
	const mainHost = requiredElement("workspace-file-main");
	const viewHost = requiredElement("workspace-file-view");
	const previewHost = requiredElement("workspace-file-preview");
	const empty = requiredElement("workspace-file-empty");
	const pathLabel = requiredElement("workspace-file-path");
	const status = requiredElement("workspace-file-status");
	const editButton = requiredButton("workspace-file-edit");
	const downloadButton = requiredButton("workspace-file-download");
	const modeControl = requiredElement("workspace-file-mode");
	const previewModeButton = requiredButton("workspace-file-preview-mode");
	const sourceModeButton = requiredButton("workspace-file-source-mode");
	const wrapControl = requiredElement("workspace-file-wrap-control");
	const wrapButton = requiredButton("workspace-file-wrap");
	const entryDialog = requiredDialog("workspace-entry-dialog");
	const entryTitle = requiredElement("workspace-entry-title");
	const entryDescription = requiredElement("workspace-entry-description");
	const entryInput = requiredInput("workspace-entry-input");
	const entryError = requiredElement("workspace-entry-error");
	const entryAction = requiredButton("workspace-entry-action");
	const confirmDialog = requiredDialog("workspace-confirm-dialog");
	const confirmTitle = requiredElement("workspace-confirm-title");
	const confirmDescription = requiredElement("workspace-confirm-description");
	const confirmCancel = requiredButton("workspace-confirm-cancel");
	const confirmAction = requiredButton("workspace-confirm-action");
	treeHost.style.cssText = workspaceTreeStyle;

	let canReveal = false;
	void api
		.canReveal()
		.then((available) => {
			canReveal = available;
			for (const button of document.querySelectorAll<HTMLButtonElement>(
				"[data-workspace-file-action]",
			)) {
				button.textContent = available ? "Show in folder" : "Download";
				button.title = available
					? "Show the saved file in your file manager"
					: "Download the saved file";
			}
		})
		.catch(() => {
			/* Keep download available if detection fails. */
		});

	let workspacePath = options.initialWorkspacePath;
	let loadedPaths: string[] = [];
	let loadedWorkspacePath: string | undefined;
	let treeDirty = false;
	let visible = false;
	let loadGeneration = 0;
	let fileGeneration = 0;
	let current: WorkspaceFileData | undefined;
	let preview: WorkspaceFilePreviewData | undefined;
	let previewRevision: string | undefined;
	let mode: "preview" | "source" = "source";
	let selectedFilePath: string | undefined;
	let draft = "";
	let dirty = false;
	let wrap = true;
	let editor: PierreEditor<"file"> | undefined;
	let previewFont: FontFace | undefined;
	const viewer = new File(viewerOptions());
	const tree = new FileTree({
		composition: {
			contextMenu: {
				enabled: true,
				render: renderContextMenu,
				triggerMode: "right-click",
			},
		},
		density: "compact",
		fileTreeSearchMode: "hide-non-matches",
		flattenEmptyDirectories: true,
		gitStatus: options.initialGitStatus,
		id: "workspace-files-tree",
		initialExpansion: "closed",
		paths: [],
		search: true,
		searchBlurBehavior: "retain",
		stickyFolders: false,
		unsafeCSS: workspaceTreeUnsafeCss,
		onSelectionChange(paths) {
			const next = paths.length === 1 ? paths[0] : undefined;
			if (!next) return;
			const item = tree.getItem(next);
			if (item?.isDirectory()) {
				setStatus("");
				item.deselect();
				return;
			}
			void selectFile(next);
		},
	});
	const treeExpansion = createWorkspaceTreeExpansion(
		tree,
		"files",
		() => workspacePath,
	);
	tree.render({ containerWrapper: treeHost });

	downloadButton.addEventListener("click", () => {
		if (selectedFilePath) void performFileAction(selectedFilePath);
	});
	previewModeButton.addEventListener("click", () => {
		if (!dirty) void setFileMode("preview");
	});
	sourceModeButton.addEventListener("click", () => void setFileMode("source"));
	editButton.addEventListener("click", () => void save());
	viewHost.addEventListener("keydown", (event) => {
		if (
			(event.ctrlKey || event.metaKey) &&
			!event.altKey &&
			!event.shiftKey &&
			event.code === "KeyS"
		) {
			event.preventDefault();
			void save();
		}
	});
	wrapButton.addEventListener("click", () => {
		wrap = !wrap;
		wrapButton.setAttribute("aria-pressed", String(wrap));
		viewer.setOptions(viewerOptions());
	});
	window.addEventListener("pi-ui-code-theme-changed", () => {
		viewer.setOptions(viewerOptions());
		viewer.rerender();
	});

	function renderContextMenu(
		item: ContextMenuItem,
		context: ContextMenuOpenContext,
	): HTMLElement {
		const menu = document.createElement("div");
		menu.className = "workspace-tree-context-menu";
		menu.setAttribute("role", "menu");
		const fileAction = fileActionButton(item, context);
		if (fileAction) menu.append(fileAction);
		menu.append(
			workspaceMenuButton(context, "New file", () => createEntry(item, "file")),
			workspaceMenuButton(context, "New folder", () => createEntry(item, "folder")),
			workspaceMenuButton(context, "Rename", () => renameEntry(item)),
			workspaceMenuButton(context, "Delete", () => deleteEntry(item), true),
		);
		return menu;
	}

	function fileActionButton(
		item: ContextMenuItem,
		context: ContextMenuOpenContext,
	): HTMLButtonElement | undefined {
		if (!canReveal && item.kind === "directory") return;
		const label = canReveal
			? item.kind === "directory"
				? "Open folder"
				: "Show in folder"
			: "Download";
		return workspaceMenuButton(context, label, () => performFileAction(item.path));
	}

	async function performFileAction(path: string): Promise<void> {
		if (canReveal) {
			try {
				await api.reveal(path);
			} catch (error) {
				await requestNotice(
					"Could not open the file manager",
					errorMessage(error),
				);
			}
			return;
		}
		const link = document.createElement("a");
		link.href = `${options.endpoint}/content?path=${encodeURIComponent(path)}&download=1`;
		link.download = path.split("/").at(-1) ?? "download";
		link.click();
	}

	async function createEntry(
		item: ContextMenuItem,
		kind: "file" | "folder",
	): Promise<void> {
		const name = await requestEntryName({
			title: `New ${kind}`,
			description: `Enter a name for the new ${kind}.`,
			action: "Create",
		});
		if (!name) return;
		const directory = item.kind === "directory" ? item.path : parentPath(item.path);
		const target = joinPath(directory, name);
		try {
			const created = await api.create(target, kind);
			await loadFiles(true);
			if (kind === "file") await openFile(created);
			else {
				const createdFolder = tree.getItem(created);
				if (createdFolder && "expand" in createdFolder) createdFolder.expand();
			}
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function renameEntry(item: ContextMenuItem): Promise<void> {
		if (entryContainsCurrentFile(item.path) && dirty) {
			await requestNotice(
				"Unsaved changes",
				"Save or discard your changes before renaming this item.",
			);
			return;
		}
		const name = await requestEntryName({
			title: `Rename ${item.kind === "directory" ? "folder" : "file"}`,
			description: `Enter a new name for ${item.name}.`,
			action: "Rename",
			initialValue: item.name,
		});
		if (!name || name === item.name) return;
		const destination = joinPath(parentPath(item.path), name);
		const currentDestination =
			selectedFilePath && entryContainsCurrentFile(item.path)
				? `${destination}${selectedFilePath.slice(item.path.length)}`
				: undefined;
		try {
			await api.move(item.path, destination);
			if (currentDestination) clearCurrentFile();
			await loadFiles(true);
			if (currentDestination) await openFile(currentDestination);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	async function deleteEntry(item: ContextMenuItem): Promise<void> {
		if (entryContainsCurrentFile(item.path) && dirty) {
			await requestNotice(
				"Unsaved changes",
				"Save or discard your changes before deleting this item.",
			);
			return;
		}
		const kind = item.kind === "directory" ? "folder" : "file";
		if (
			!(await requestConfirmation({
				title: `Delete ${kind}?`,
				description: `This will permanently delete ${item.name}${
					item.kind === "directory" ? " and all of its contents" : ""
				}. This action cannot be undone.`,
				action: "Delete",
			}))
		)
			return;
		try {
			await api.remove(item.path);
			if (entryContainsCurrentFile(item.path)) clearCurrentFile();
			await loadFiles(true);
		} catch (error) {
			setStatus(errorMessage(error));
		}
	}

	function clearCurrentFile(): void {
		fileGeneration += 1;
		stopEditing();
		current = undefined;
		preview = undefined;
		previewRevision = undefined;
		mode = "source";
		draft = "";
		dirty = false;
		setSelectedFilePath();
		pathLabel.textContent = "Select a file";
		setStatus("");
		showEmpty("Open a file from the workspace");
		syncToolbar();
	}

	function entryContainsCurrentFile(path: string): boolean {
		return (
			selectedFilePath === path || selectedFilePath?.startsWith(`${path}/`) === true
		);
	}

	function viewerOptions(): FileOptions<undefined, undefined> {
		return {
			disableFileHeader: true,
			overflow: wrap ? "wrap" : "scroll",
			tokenizeMaxLineLength: 10_000,
			theme: getPierreThemes(),
			themeType: "system",
			onEditChange({ file }) {
				draft = file.contents;
				dirty = draft !== current?.contents;
				syncSaveButton();
			},
			unsafeCSS: `
				@media (prefers-reduced-motion: no-preference) {
					[data-caret] {
						animation-timing-function: step-end;
					}
				}

				::selection {
					color: currentColor;
				}

				[data-file] {
					min-width: 100%;
				}
			`,
		};
	}

	function setVisible(next: boolean): void {
		visible = next;
		if (visible) void loadFiles();
	}

	async function openFile(path: string): Promise<void> {
		visible = true;
		await loadFiles();
		for (const selectedPath of tree.getSelectedPaths()) {
			tree.getItem(selectedPath)?.deselect();
		}
		const item = tree.getItem(path);
		if (item) item.select();
		else await selectFile(path);
	}

	function refresh(treeChanged = true): void {
		void refreshFromDisk(treeChanged);
	}

	function refreshAfterDiscard(path: string): void {
		if (current?.path === path) {
			dirty = false;
			syncSaveButton();
		}
		void refreshFromDisk();
	}

	async function refreshFromDisk(treeChanged = true): Promise<void> {
		const observedPath = selectedFilePath;
		const observedRevision = current?.revision ?? previewRevision;
		const observedGeneration = fileGeneration;
		await loadFiles(treeChanged);
		if (!observedPath || fileGeneration !== observedGeneration) return;
		try {
			const file = await api.read(observedPath);
			if (
				selectedFilePath !== observedPath ||
				fileGeneration !== observedGeneration
			)
				return;
			if ("message" in file) {
				if (dirty) setStatus("File changed on disk");
				else {
					clearCurrentFile();
					setSelectedFilePath(file.path);
					pathLabel.textContent = file.path;
					setStatus(formatBytes(file.size));
					showEmpty(file.message);
				}
				return;
			}
			if ("revision" in file && observedRevision === file.revision) return;
			if (dirty) {
				setStatus("File changed on disk");
				return;
			}
			const generation = ++fileGeneration;
			stopEditing();
			setStatus(formatBytes(file.size));
			if ("contents" in file) {
				current = file;
				preview = file.preview;
				previewRevision = file.revision;
				draft = file.contents;
				mode = preview ? mode : "source";
				if (mode === "preview") renderPreview();
				else await renderSource(generation);
			} else {
				current = undefined;
				preview = file.preview;
				previewRevision = file.revision;
				draft = "";
				mode = "preview";
				renderPreview();
			}
			syncToolbar();
		} catch (error) {
			if (
				selectedFilePath !== observedPath ||
				fileGeneration !== observedGeneration
			)
				return;
			setStatus(errorMessage(error));
		}
	}

	function setGitStatus(next: readonly GitStatusEntry[]): void {
		tree.setGitStatus(next);
	}

	function setWorkspace(next: string): void {
		if (workspacePath === next) return;
		treeExpansion.save();
		workspacePath = next;
		loadedPaths = [];
		loadedWorkspacePath = undefined;
		loadGeneration += 1;
		clearCurrentFile();
		tree.resetPaths([]);
		if (visible) void loadFiles();
	}

	async function loadFiles(force = false): Promise<void> {
		if (force) treeDirty = true;
		const generation = ++loadGeneration;
		if (!visible || (!treeDirty && loadedWorkspacePath === workspacePath)) return;
		if (!force) setStatus("Loading files…");
		try {
			const data = await api.list();
			if (generation !== loadGeneration || data.workspacePath !== workspacePath)
				return;
			treeExpansion.sync(
				loadedWorkspacePath === workspacePath ? loadedPaths : undefined,
				data.paths,
			);
			loadedWorkspacePath = workspacePath;
			loadedPaths = data.paths;
			treeDirty = false;
			// Linked files need not appear in the workspace tree. Keep the open
			// file (including unavailable previews) selected when the tree refreshes.
			if (selectedFilePath) {
				if (current) setStatus(formatBytes(current.size));
				return;
			}
			const initial = data.paths.includes("README.md")
				? "README.md"
				: data.paths.find((path) => !path.endsWith("/"));
			if (initial) tree.getItem(initial)?.select();
			else {
				setStatus("");
				showEmpty("No files in this workspace");
			}
		} catch (error) {
			if (generation !== loadGeneration) return;
			setStatus(errorMessage(error));
			showEmpty("Could not load workspace files");
		}
	}

	async function selectFile(path: string): Promise<void> {
		if (selectedFilePath === path) return;
		if (
			dirty &&
			!(await requestConfirmation({
				title: "Discard unsaved changes?",
				description: `Your unsaved changes to ${current?.path ?? "this file"} will be lost.`,
				action: "Discard",
			}))
		) {
			tree.getItem(path)?.deselect();
			tree.getItem(current?.path ?? "")?.select();
			return;
		}
		const generation = ++fileGeneration;
		stopEditing();
		current = undefined;
		preview = undefined;
		previewRevision = undefined;
		dirty = false;
		pathLabel.textContent = path;
		setSelectedFilePath();
		setStatus("");
		try {
			const file = await api.read(path);
			if (generation !== fileGeneration) return;
			setSelectedFilePath(file.path);
			pathLabel.textContent = file.path;
			setStatus(formatBytes(file.size));
			if ("message" in file) {
				mode = "source";
				showEmpty(file.message);
				syncToolbar();
				return;
			}
			preview = file.preview;
			previewRevision = file.revision;
			mode = preview ? "preview" : "source";
			if ("contents" in file) {
				current = file;
				draft = file.contents;
				if (mode === "source") await renderSource(generation);
				else renderPreview();
			} else {
				draft = "";
				renderPreview();
			}
			syncToolbar();
		} catch (error) {
			if (generation !== fileGeneration) return;
			current = undefined;
			preview = undefined;
			previewRevision = undefined;
			mode = "source";
			setStatus("");
			showEmpty(errorMessage(error));
			syncToolbar();
		}
	}

	async function setFileMode(next: "preview" | "source"): Promise<void> {
		if (next === mode || (next === "preview" && (!preview || dirty))) return;
		if (next === "source" && !current) return;
		const generation = ++fileGeneration;
		mode = next;
		stopEditing();
		if (mode === "preview") renderPreview();
		else await renderSource(generation);
		syncToolbar();
	}

	async function renderSource(generation: number): Promise<void> {
		if (!current) return;
		clearFontPreview();
		previewHost.replaceChildren();
		previewHost.hidden = true;
		empty.hidden = true;
		viewHost.hidden = false;
		const language: SupportedLanguages = current.path.toLowerCase().endsWith(".svg")
			? "xml"
			: getFiletypeFromFileName(current.path);
		const file = {
			cacheKey: `${workspacePath}:${current.path}:${current.revision}`,
			contents: draft,
			lang: language,
			name: current.path,
		};
		const themes = getPierreThemes();
		await preloadHighlighter({
			langs: [language],
			themes: [themes.dark, themes.light],
		}).catch(() => undefined);
		if (generation !== fileGeneration) return;
		viewer.render({ file, containerWrapper: viewHost });
		await startEditing(generation);
	}

	function renderPreview(): void {
		if (!preview) return;
		stopEditing();
		clearFontPreview();
		const previewData = preview;
		const label = selectedFilePath?.split("/").at(-1) ?? "file";
		let element: HTMLElement;
		if (previewData.kind === "markdown") {
			const article = document.createElement("article");
			article.className = "workspace-file-markdown markdown-content";
			const parsedDocument = new DOMParser().parseFromString(
				previewData.html,
				"text/html",
			);
			article.append(...parsedDocument.body.childNodes);
			element = article;
		} else if (previewData.kind === "image") {
			const image = new Image();
			image.alt = `Preview of ${label}`;
			image.decoding = "async";
			if (previewData.mimeType === "image/svg+xml") image.role = "img";
			element = image;
		} else if (previewData.kind === "audio") {
			const audio = document.createElement("audio");
			audio.controls = true;
			audio.preload = "metadata";
			audio.textContent = "This browser cannot preview this audio file.";
			element = audio;
		} else if (previewData.kind === "font") {
			element = createFontPreview(previewData.url, label);
		} else if (previewData.kind === "video") {
			const video = document.createElement("video");
			video.controls = true;
			video.playsInline = true;
			video.preload = "metadata";
			video.textContent = "This browser cannot preview this video file.";
			element = video;
		} else {
			const frame = document.createElement("iframe");
			frame.referrerPolicy = "no-referrer";
			frame.title = `Preview of ${label}`;
			element = frame;
		}
		if ("url" in previewData && previewData.kind !== "font") {
			const url = previewData.url;
			element.addEventListener("error", () => {
				if (mode === "preview" && url === element.getAttribute("src")) {
					showEmpty("This browser cannot preview this file.");
				}
			});
			element.setAttribute("src", url);
		}
		previewHost.replaceChildren(element);
		empty.hidden = true;
		viewHost.hidden = true;
		previewHost.hidden = false;
	}

	function createFontPreview(url: string, label: string): HTMLElement {
		const article = document.createElement("article");
		article.className = "workspace-font-preview";
		const heading = document.createElement("h2");
		heading.className = "sr-only";
		heading.textContent = `Font specimen for ${label}`;
		const loading = document.createElement("p");
		loading.className = "workspace-font-loading";
		loading.textContent = "Loading font…";
		const specimen = document.createElement("div");
		specimen.className = "workspace-font-specimen";
		specimen.hidden = true;
		for (const [className, text] of [
			["workspace-font-display", "Hamburgefontsiv"],
			["workspace-font-sample", "The quick brown fox jumps over the lazy dog."],
			["workspace-font-sample", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
			["workspace-font-sample", "abcdefghijklmnopqrstuvwxyz"],
			["workspace-font-sample", "0123456789 · !?&@#$%"],
			["workspace-font-sample", "ÁÉÍÓÚ"],
			["workspace-font-sample", "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"],
			["workspace-font-sample", "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"],
			[
				"workspace-font-sample",
				"Съешь же ещё этих мягких французских булок, да выпей чаю.",
			],
		] as const) {
			const line = document.createElement("p");
			line.className = className;
			line.textContent = text;
			specimen.append(line);
		}
		article.append(heading, loading, specimen);

		const family = `pi-ui-font-preview-${fileGeneration}`;
		const font = new FontFace(family, `url(${JSON.stringify(url)})`);
		previewFont = font;
		void font.load().then(
			(loaded) => {
				if (previewFont !== font) return;
				document.fonts.add(loaded);
				specimen.style.fontFamily = family;
				specimen.hidden = false;
				loading.remove();
			},
			() => {
				if (previewFont === font)
					showEmpty("This browser cannot preview this font.");
			},
		);
		return article;
	}

	function clearFontPreview(): void {
		if (!previewFont) return;
		document.fonts.delete(previewFont);
		previewFont = undefined;
	}

	async function startEditing(generation: number): Promise<void> {
		editButton.disabled = true;
		try {
			const { Editor } = await import("@pierre/diffs/edit");
			if (generation !== fileGeneration || !current) return;
			editor = new Editor("file");
			editor.edit(viewer);
		} catch (error) {
			editor = undefined;
			setStatus(errorMessage(error));
		} finally {
			syncSaveButton();
		}
	}

	async function save(): Promise<void> {
		if (!current || !editor || !dirty) return;
		editButton.disabled = true;
		setStatus("Saving…");
		try {
			current = await api.save(current.path, draft, current.revision);
			preview = current.preview;
			previewRevision = current.revision;
			draft = current.contents;
			dirty = false;
			setStatus(formatBytes(current.size));
		} catch (error) {
			setStatus(errorMessage(error));
		} finally {
			syncSaveButton();
		}
	}

	function stopEditing(): void {
		// Saving is handled by the API. Do not install an editor completion
		// over the disk snapshot, even when its contents are unchanged.
		editor?.cleanUp("discard");
		editor = undefined;
		syncSaveButton();
	}

	function setSelectedFilePath(path?: string): void {
		selectedFilePath = path;
		downloadButton.hidden = !path;
	}

	function syncSaveButton(): void {
		syncToolbar();
	}

	function syncToolbar(): void {
		const sourceVisible = Boolean(current) && mode === "source";
		modeControl.hidden = !current?.preview;
		previewModeButton.setAttribute("aria-pressed", String(mode === "preview"));
		previewModeButton.disabled = dirty;
		sourceModeButton.setAttribute("aria-pressed", String(mode === "source"));
		wrapControl.hidden = !sourceVisible;
		editButton.hidden = !sourceVisible;
		editButton.disabled = !sourceVisible || !editor || !dirty;
	}

	function showEmpty(message: string): void {
		clearFontPreview();
		previewHost.replaceChildren();
		empty.textContent = message;
		empty.hidden = false;
		viewHost.hidden = true;
		previewHost.hidden = true;
	}

	function setStatus(message: string): void {
		status.textContent = message;
	}

	function requestEntryName(options: {
		title: string;
		description: string;
		action: string;
		initialValue?: string;
	}): Promise<string | undefined> {
		entryTitle.textContent = options.title;
		entryDescription.textContent = options.description;
		entryAction.textContent = options.action;
		entryInput.value = options.initialValue ?? "";
		entryError.textContent = "";
		entryError.hidden = true;
		entryDialog.returnValue = "";
		const { promise, resolve } = Promise.withResolvers<string | undefined>();
		entryDialog.addEventListener(
			"close",
			() =>
				resolve(
					entryDialog.returnValue === "submit" ? entryInput.value : undefined,
				),
			{ once: true },
		);
		entryDialog.showModal();
		entryInput.select();
		return promise;
	}

	function submitEntryName(): void {
		if (!validEntryName(entryInput.value)) {
			entryError.textContent =
				"Use a non-empty name without slashes, '.', or '..'.";
			entryError.hidden = false;
			return;
		}
		entryDialog.close("submit");
	}

	function requestConfirmation(options: {
		title: string;
		description: string;
		action: string;
		showCancel?: boolean;
		destructive?: boolean;
	}): Promise<boolean> {
		confirmTitle.textContent = options.title;
		confirmDescription.textContent = options.description;
		confirmAction.textContent = options.action;
		confirmCancel.hidden = options.showCancel === false;
		confirmAction.dataset.variant =
			options.destructive === false ? "default" : "destructive";
		confirmDialog.returnValue = "";
		const { promise, resolve } = Promise.withResolvers<boolean>();
		confirmDialog.addEventListener(
			"close",
			() => resolve(confirmDialog.returnValue === "confirm"),
			{ once: true },
		);
		confirmDialog.showModal();
		return promise;
	}

	async function requestNotice(title: string, description: string): Promise<void> {
		await requestConfirmation({
			title,
			description,
			action: "OK",
			showCancel: false,
			destructive: false,
		});
	}

	entryAction.addEventListener("click", submitEntryName);
	entryInput.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || event.isComposing) return;
		event.preventDefault();
		submitEntryName();
	});
	function focusTree(): void {
		const path =
			tree.getSelectedPaths()[0] ?? tree.getFocusedPath() ?? loadedPaths[0];
		if (path) tree.scrollToPath(path, { focus: true });
		focusTreeHost(treeHost);
	}

	function focusEditor(): void {
		(mode === "preview" && preview
			? previewHost
			: current
				? viewHost
				: mainHost
		).focus({ preventScroll: true });
	}

	function cleanUp(): void {
		treeExpansion.save();
		stopEditing();
		clearFontPreview();
		previewHost.replaceChildren();
		viewer.cleanUp();
		tree.cleanUp();
	}

	syncSaveButton();
	showEmpty("Open a file from the workspace");
	return {
		cleanUp,
		focusEditor,
		focusTree,
		fileActionButton,
		performFileAction,
		openFile,
		refresh,
		refreshAfterDiscard,
		requestConfirmation,
		requestNotice,
		setGitStatus,
		setVisible,
		setWorkspace,
	};
}

function validEntryName(value: string | null): value is string {
	return Boolean(
		value &&
		value === value.trim() &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\"),
	);
}

function parentPath(value: string): string {
	const separator = value.lastIndexOf("/");
	return separator === -1 ? "" : value.slice(0, separator);
}

function joinPath(parent: string, name: string): string {
	return parent ? `${parent}/${name}` : name;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
