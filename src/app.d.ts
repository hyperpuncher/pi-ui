interface BasecoatRefreshRoot {
	readonly nodeType?: number;
}

interface TransferFileCollection {
	readonly length: number;
}

interface FileTransferData {
	readonly files?: TransferFileCollection;
	readonly types?: readonly string[];
}

interface PiUiNamespace {
	basecoat: {
		refresh(root?: BasecoatRefreshRoot): void;
	};
	codeTheme: {
		loadFontPreviews(light: string, dark: string): void;
		loadPreviews(): void;
	};
	fonts: {
		apply(mono: string, sans: string): void;
	};
	dialogs: {
		toggleSession(): boolean;
		openTree(): void;
		openCommand(): void;
		toggleCommand(): boolean;
		openWorkspace(): void;
		openWorkspaceBrowser(): void;
		toggleWorkspace(): boolean;
		togglePopover(triggerId: string): boolean;
	};
	fileTransfer: {
		pick(): Promise<void>;
		hasFiles(data?: FileTransferData): boolean;
		insert(data?: FileTransferData | TransferFileCollection): Promise<void>;
		hasAttachments(): boolean;
		canSubmit(prompt: string): boolean;
		submit(
			endpoint: string,
			prompt: string,
			streamingBehavior?: "steer" | "followUp",
		): Promise<boolean>;
		enterDrag(): boolean;
		leaveDrag(): boolean;
		resetDrag(): void;
	};
	messageScroll: {
		bindResize(): void;
		captureAnchor(): boolean;
		hydratePierreDiff(element: HTMLElement): void;
		restoreAnchor(): void;
		scrollBottom(behavior?: "auto" | "smooth"): void;
	};
	modelSearch: {
		filter(input: HTMLInputElement, query: string): void;
	};
	pickers: {
		close(): void;
		fuzzyMatch(query: string, text: string): { matches: boolean; score: number };
		isFileOpen(): boolean;
		isOpen(): boolean;
		resetFile(): void;
	};
	prompt: {
		bindLayout(): void;
		clear(): void;
	};
	promptHistory: {
		handleInput(): void;
		handleKeydown(event: KeyboardEvent, entries: readonly string[]): boolean;
	};
	sessionPerformance: {
		observe(status: string, generation: number): void;
		start(): void;
	};
	windowFocus: {
		restore(): void;
		suspend(): void;
	};
	workspaceReview: {
		applyOpen(open: boolean): void;
		focusEditor(): void;
		focusFiles(): void;
		focusGit(): void;
	};
	shouldAbortOnEscape(event: KeyboardEvent): boolean;
}

interface Window {
	piUi: PiUiNamespace;
}

declare namespace JSX {
	interface HtmlTag {
		autofocus?: boolean;
	}

	interface IntrinsicElements {
		"datastar-inspector": Record<string, never>;
	}
}
