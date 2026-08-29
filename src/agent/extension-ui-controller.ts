import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	Theme,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";

import type {
	AppExtensionDialog,
	AppExtensionWidget,
	AppStore,
} from "../state/app-store.ts";

const defaultWorkingVisible = true;
// SAFETY: the proxy throws before exposing any property from the placeholder.
const unsupportedTheme = new Proxy({} as Theme, {
	get: () => unsupported("TUI themes"),
});

type PendingDialog = {
	dialog: AppExtensionDialog;
	respond(value: string | undefined, cancelled: boolean): void;
	signal?: AbortSignal;
	abort?: () => void;
	timer?: ReturnType<typeof setTimeout>;
};

/** Bridges pi extension UI requests to backend-owned web state. */
export class ExtensionUiController {
	readonly #queue: PendingDialog[] = [];
	readonly #statuses = new Map<string, string>();
	readonly #widgets = new Map<string, AppExtensionWidget>();
	#active: PendingDialog | undefined;
	#workingIndicator: string | undefined;
	#workingMessage: string | undefined;
	#workingVisible = defaultWorkingVisible;

	constructor(private readonly store: AppStore) {}

	context(isActive: () => boolean): ExtensionUIContext {
		return {
			select: (title, options, dialogOptions) =>
				this.select(isActive, title, options, dialogOptions),
			confirm: (title, message, dialogOptions) =>
				this.confirm(isActive, title, message, dialogOptions),
			input: (title, placeholder, dialogOptions) =>
				this.input(isActive, title, placeholder, dialogOptions),
			notify: (message, type = "info") => {
				if (!isActive()) return;
				this.store.appendMessage(
					"notice",
					type === "info" ? message : `${type}: ${message}`,
				);
			},
			onTerminalInput: () => unsupported("raw terminal input"),
			setStatus: (key, text) => {
				if (!isActive()) return;
				if (text === undefined) this.#statuses.delete(key);
				else this.#statuses.set(key, text);
				this.store.setExtensionStatuses(
					[...this.#statuses].map(([statusKey, statusText]) => ({
						key: statusKey,
						text: statusText,
					})),
				);
			},
			setWorkingMessage: (message) => {
				if (!isActive()) return;
				this.#workingMessage = message;
				this.syncWorking();
			},
			setWorkingVisible: (visible) => {
				if (!isActive()) return;
				this.#workingVisible = visible;
				this.syncWorking();
			},
			setWorkingIndicator: (options) => {
				if (!isActive()) return;
				this.#workingIndicator = firstWorkingFrame(options);
				this.syncWorking();
			},
			setHiddenThinkingLabel: (label) => {
				if (isActive() && label !== undefined) {
					unsupported("custom thinking labels");
				}
			},
			setWidget: (key, content, options) => {
				if (!isActive()) return;
				if (content === undefined) this.#widgets.delete(key);
				else if (Array.isArray(content)) {
					this.#widgets.set(key, {
						key,
						lines: [...content],
						placement: options?.placement ?? "aboveEditor",
					});
				} else unsupported("component widgets");
				this.store.setExtensionWidgets([...this.#widgets.values()]);
			},
			setFooter: (factory) => {
				if (isActive() && factory) unsupported("custom footer components");
			},
			setHeader: (factory) => {
				if (isActive() && factory) unsupported("custom header components");
			},
			setTitle: (title) => {
				if (isActive()) this.store.setDocumentTitle(title);
			},
			custom: async () => unsupported("custom TUI components"),
			pasteToEditor: (text) => {
				if (!isActive()) return;
				this.setEditorText(`${this.store.promptEditorText}${text}`);
			},
			setEditorText: (text) => {
				if (isActive()) this.setEditorText(text);
			},
			getEditorText: () => (isActive() ? this.store.promptEditorText : ""),
			editor: (title, prefill) => this.editor(isActive, title, prefill),
			addAutocompleteProvider: () => {
				if (isActive()) unsupported("autocomplete providers");
			},
			setEditorComponent: (factory) => {
				if (isActive() && factory) unsupported("custom editor components");
			},
			getEditorComponent: () => undefined,
			theme: unsupportedTheme,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({
				success: false,
				error: "TUI themes are unavailable in pi-ui",
			}),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {
				if (isActive()) unsupported("global tool expansion state");
			},
		};
	}

	respond(id: string, value: string | undefined, cancelled: boolean): boolean {
		if (this.#active?.dialog.id !== id) return false;
		const active = this.#active;
		this.finish(active);
		active.respond(value, cancelled);
		this.showNext();
		return true;
	}

	cancelAll(): void {
		const pending = [this.#active, ...this.#queue].filter(
			(dialog): dialog is PendingDialog => dialog !== undefined,
		);
		this.#active = undefined;
		this.#queue.length = 0;
		for (const dialog of pending) {
			this.cleanup(dialog);
			dialog.respond(undefined, true);
		}
		this.#statuses.clear();
		this.#widgets.clear();
		this.#workingIndicator = undefined;
		this.#workingMessage = undefined;
		this.#workingVisible = defaultWorkingVisible;
		this.store.setExtensionDialog(undefined);
		this.store.setExtensionStatuses([]);
		this.store.setExtensionWidgets([]);
		this.syncWorking();
		this.store.setDocumentTitle("pi-ui");
	}

	private select(
		isActive: () => boolean,
		title: string,
		options: string[],
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		if (!isActive()) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			this.enqueue(
				{
					dialog: {
						id: crypto.randomUUID(),
						kind: "select",
						title,
						options: [...options],
					},
					respond: (value, cancelled) =>
						resolve(
							!cancelled && value !== undefined && options.includes(value)
								? value
								: undefined,
						),
				},
				dialogOptions,
			);
		});
	}

	private confirm(
		isActive: () => boolean,
		title: string,
		message: string,
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<boolean> {
		if (!isActive()) return Promise.resolve(false);
		return new Promise((resolve) => {
			this.enqueue(
				{
					dialog: { id: crypto.randomUUID(), kind: "confirm", title, message },
					respond: (value, cancelled) =>
						resolve(!cancelled && value === "confirm"),
				},
				dialogOptions,
			);
		});
	}

	private input(
		isActive: () => boolean,
		title: string,
		placeholder?: string,
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return this.textDialog(
			isActive,
			{
				id: crypto.randomUUID(),
				kind: "input",
				title,
				placeholder,
			},
			dialogOptions,
		);
	}

	private editor(
		isActive: () => boolean,
		title: string,
		prefill?: string,
	): Promise<string | undefined> {
		return this.textDialog(isActive, {
			id: crypto.randomUUID(),
			kind: "editor",
			title,
			prefill,
		});
	}

	private textDialog(
		isActive: () => boolean,
		dialog: Extract<AppExtensionDialog, { kind: "input" | "editor" }>,
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		if (!isActive()) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			this.enqueue(
				{
					dialog,
					respond: (value, cancelled) =>
						resolve(cancelled ? undefined : (value ?? "")),
				},
				dialogOptions,
			);
		});
	}

	private enqueue(
		pending: PendingDialog,
		options: ExtensionUIDialogOptions | undefined,
	): void {
		if (options?.signal?.aborted) {
			pending.respond(undefined, true);
			return;
		}
		pending.signal = options?.signal;
		if (pending.signal) {
			pending.abort = () => this.abort(pending);
			pending.signal.addEventListener("abort", pending.abort, { once: true });
		}
		if (options?.timeout !== undefined) {
			pending.timer = setTimeout(() => this.abort(pending), options.timeout);
		}
		this.#queue.push(pending);
		this.showNext();
	}

	private showNext(): void {
		if (this.#active) return;
		this.#active = this.#queue.shift();
		this.store.setExtensionDialog(this.#active?.dialog);
	}

	private abort(pending: PendingDialog): void {
		if (pending === this.#active) {
			this.finish(pending);
			pending.respond(undefined, true);
			this.showNext();
			return;
		}
		const index = this.#queue.indexOf(pending);
		if (index < 0) return;
		this.#queue.splice(index, 1);
		this.cleanup(pending);
		pending.respond(undefined, true);
	}

	private finish(pending: PendingDialog): void {
		this.cleanup(pending);
		this.#active = undefined;
		this.store.setExtensionDialog(undefined);
	}

	private cleanup(pending: PendingDialog): void {
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		if (pending.signal && pending.abort) {
			pending.signal.removeEventListener("abort", pending.abort);
		}
	}

	private setEditorText(text: string): void {
		this.store.setPromptEditorText(text);
	}

	private syncWorking(): void {
		this.store.setExtensionWorking({
			message: this.#workingMessage,
			visible: this.#workingVisible,
			indicator: this.#workingIndicator,
		});
	}
}

function firstWorkingFrame(
	options: WorkingIndicatorOptions | undefined,
): string | undefined {
	if (!options?.frames) return undefined;
	return options.frames[0] ?? "";
}

function unsupported(capability: string): never {
	throw new Error(`${capability} are not supported by the pi-ui web interface`);
}
