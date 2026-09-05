import { File, type FileOptions } from "@pierre/diffs";
import type { Editor as PierreEditor } from "@pierre/diffs/edit";
import {
	type ContextMenuItem,
	type ContextMenuOpenContext,
	FileTree,
	type GitStatusEntry,
} from "@pierre/trees";

import { getPierreThemes } from "../pierre-theme.ts";
import { workspaceTreeStyle, workspaceTreeUnsafeCss } from "../workspace-review-tree.ts";
import {
	createWorkspaceFilesApi,
	type WorkspaceFileData,
} from "./workspace-files-api.ts";

type WorkspaceFilesOptions = {
	endpoint: string;
	initialGitStatus: readonly GitStatusEntry[];
	initialWorkspacePath: string;
};

export function createWorkspaceFiles(options: WorkspaceFilesOptions) {
	const api = createWorkspaceFilesApi(options.endpoint);
	const treeHost = requiredElement("workspace-file-tree");
	const mainHost = requiredElement("workspace-file-main");
	const viewHost = requiredElement("workspace-file-view");
	const empty = requiredElement("workspace-file-empty");
	const pathLabel = requiredElement("workspace-file-path");
	const status = requiredElement("workspace-file-status");
	const editButton = requiredButton("workspace-file-edit");
	const downloadButton = requiredButton("workspace-file-download");
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

	let workspacePath = options.initialWorkspacePath;
	let loadedPaths: string[] = [];
	let loadedWorkspacePath: string | undefined;
	let visible = false;
	let loadGeneration = 0;
	let fileGeneration = 0;
	let current: WorkspaceFileData | undefined;
	let selectedFilePath: string | undefined;
	let draft = "";
	let dirty = false;
	let wrap = true;
	let editor: PierreEditor<"file"> | undefined;
	let detachEditor: (() => void) | undefined;
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
	tree.render({ containerWrapper: treeHost });

	downloadButton.addEventListener("click", () => {
		const path = selectedFilePath;
		if (!path) return;
		const link = document.createElement("a");
		link.href = `${options.endpoint}/content?path=${encodeURIComponent(path)}&download=1`;
		link.download = path.split("/").at(-1) ?? "download";
		link.click();
	});
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
		menu.append(
			contextMenuButton("New file", () => {
				context.close({ restoreFocus: false });
				void createEntry(item, "file");
			}),
			contextMenuButton("New folder", () => {
				context.close({ restoreFocus: false });
				void createEntry(item, "folder");
			}),
			contextMenuButton("Rename", () => {
				context.close({ restoreFocus: false });
				void renameEntry(item);
			}),
			contextMenuButton(
				"Delete",
				() => {
					context.close({ restoreFocus: false });
					void deleteEntry(item);
				},
				true,
			),
		);
		return menu;
	}

	function contextMenuButton(
		label: string,
		onClick: () => void,
		destructive = false,
	): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `workspace-tree-context-menu-item${
			destructive ? " workspace-tree-context-menu-item-destructive" : ""
		}`;
		button.setAttribute("role", "menuitem");
		button.textContent = label;
		button.addEventListener("click", onClick);
		return button;
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
			current && entryContainsCurrentFile(item.path)
				? `${destination}${current.path.slice(item.path.length)}`
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
		draft = "";
		dirty = false;
		setSelectedFilePath();
		pathLabel.textContent = "Select a file";
		setStatus("");
		showEmpty("Open a file from the workspace");
		syncSaveButton();
	}

	function entryContainsCurrentFile(path: string): boolean {
		return current?.path === path || current?.path.startsWith(`${path}/`) === true;
	}

	function viewerOptions(): FileOptions<undefined, undefined> {
		return {
			disableFileHeader: true,
			overflow: wrap ? "wrap" : "scroll",
			theme: getPierreThemes(),
			themeType: "system",
			onEditChange({ file }) {
				draft = file.contents;
				dirty = draft !== current?.contents;
				syncSaveButton();
			},
			onEditComplete({ file }) {
				if (!current || file.contents !== current.contents) return "reject";
				file.cacheKey = `${workspacePath}:${current.path}:${current.revision}`;
				return "accept";
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

	function refresh(): void {
		void refreshFromDisk();
	}

	function refreshAfterDiscard(path: string): void {
		if (current?.path === path) {
			dirty = false;
			syncSaveButton();
		}
		void refreshFromDisk();
	}

	async function refreshFromDisk(): Promise<void> {
		const observed = current;
		const observedGeneration = fileGeneration;
		await loadFiles(true);
		if (!observed || current !== observed || fileGeneration !== observedGeneration)
			return;
		try {
			const file = await api.read(observed.path);
			if (current !== observed || fileGeneration !== observedGeneration) return;
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
			if (file.revision === observed.revision) return;
			if (dirty) {
				setStatus("File changed on disk");
				return;
			}
			const generation = ++fileGeneration;
			stopEditing();
			current = file;
			draft = file.contents;
			viewer.render({
				file: {
					cacheKey: `${workspacePath}:${file.path}:${file.revision}`,
					contents: file.contents,
					name: file.path,
				},
				containerWrapper: viewHost,
			});
			setStatus(formatBytes(file.size));
			syncSaveButton();
			await startEditing(generation);
		} catch (error) {
			if (current !== observed || fileGeneration !== observedGeneration) return;
			setStatus(errorMessage(error));
		}
	}

	function setGitStatus(next: readonly GitStatusEntry[]): void {
		tree.setGitStatus(next);
	}

	function setWorkspace(next: string): void {
		if (workspacePath === next) return;
		workspacePath = next;
		loadedPaths = [];
		loadedWorkspacePath = undefined;
		loadGeneration += 1;
		clearCurrentFile();
		tree.resetPaths([]);
		if (visible) void loadFiles();
	}

	async function loadFiles(force = false): Promise<void> {
		if (!visible || (!force && loadedWorkspacePath === workspacePath)) return;
		const generation = ++loadGeneration;
		if (!force) setStatus("Loading files…");
		try {
			const data = await api.list();
			if (generation !== loadGeneration || data.workspacePath !== workspacePath)
				return;
			loadedWorkspacePath = workspacePath;
			if (!samePaths(loadedPaths, data.paths)) {
				loadedPaths = data.paths;
				tree.resetPaths(data.paths);
			}
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
		if (current?.path === path) return;
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
		dirty = false;
		pathLabel.textContent = path;
		setSelectedFilePath();
		setStatus("");
		try {
			const file = await api.read(path);
			if (generation !== fileGeneration) return;
			setSelectedFilePath(file.path);
			setStatus(formatBytes(file.size));
			if ("message" in file) {
				current = undefined;
				showEmpty(file.message);
				syncSaveButton();
				return;
			}
			current = file;
			draft = file.contents;
			pathLabel.textContent = file.path;
			viewer.render({
				file: {
					cacheKey: `${workspacePath}:${file.path}:${file.revision}`,
					contents: file.contents,
					name: file.path,
				},
				containerWrapper: viewHost,
			});
			hideEmpty();
			setStatus(formatBytes(file.size));
			syncSaveButton();
			await startEditing(generation);
		} catch (error) {
			if (generation !== fileGeneration) return;
			current = undefined;
			setStatus("");
			showEmpty(errorMessage(error));
			syncSaveButton();
		}
	}

	async function startEditing(generation: number): Promise<void> {
		editButton.disabled = true;
		try {
			const { Editor } = await import("@pierre/diffs/edit");
			if (generation !== fileGeneration || !current) return;
			editor = new Editor("file");
			detachEditor = editor.edit(viewer);
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
		detachEditor?.();
		detachEditor = undefined;
		editor?.cleanUp();
		editor = undefined;
		syncSaveButton();
	}

	function setSelectedFilePath(path?: string): void {
		selectedFilePath = path;
		downloadButton.disabled = !path;
	}

	function syncSaveButton(): void {
		editButton.disabled = !current || !editor || !dirty;
	}

	function showEmpty(message: string): void {
		empty.textContent = message;
		empty.style.display = "grid";
		viewHost.style.display = "none";
	}

	function hideEmpty(): void {
		empty.style.display = "none";
		viewHost.style.display = "block";
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
		return new Promise((resolve) => {
			entryDialog.addEventListener(
				"close",
				() =>
					resolve(
						entryDialog.returnValue === "submit"
							? entryInput.value
							: undefined,
					),
				{ once: true },
			);
			entryDialog.showModal();
			entryInput.select();
		});
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
		return new Promise((resolve) => {
			confirmDialog.addEventListener(
				"close",
				() => resolve(confirmDialog.returnValue === "confirm"),
				{ once: true },
			);
			confirmDialog.showModal();
		});
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
		requestAnimationFrame(() => {
			const container = treeHost.querySelector("file-tree-container");
			const root =
				container?.shadowRoot?.querySelector<HTMLElement>('[role="tree"]');
			(root ?? treeHost).focus({ preventScroll: true });
		});
	}

	function focusEditor(): void {
		(current ? viewHost : mainHost).focus({ preventScroll: true });
	}

	function cleanUp(): void {
		stopEditing();
		viewer.cleanUp();
		tree.cleanUp();
	}

	syncSaveButton();
	showEmpty("Open a file from the workspace");
	return {
		cleanUp,
		focusEditor,
		focusTree,
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

function errorMessage(error: ErrorOptions["cause"]): string {
	return String(error).replace(/^Error: /, "");
}

function samePaths(current: readonly string[], next: readonly string[]): boolean {
	return (
		current.length === next.length &&
		current.every((path, index) => path === next[index])
	);
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

function requiredElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`);
	return element;
}

function requiredButton(id: string): HTMLButtonElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing #${id}`);
	return element;
}

function requiredDialog(id: string): HTMLDialogElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLDialogElement)) throw new Error(`Missing #${id}`);
	return element;
}

function requiredInput(id: string): HTMLInputElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);
	return element;
}
