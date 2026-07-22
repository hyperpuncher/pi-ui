interface PiUiNamespace {
	basecoat: {
		refresh(root?: unknown): void;
	};
	dialogs: {
		toggleSession(): boolean;
		openTree(): void;
		openWorkspace(): void;
		toggleWorkspace(): boolean;
	};
	fileTransfer: {
		pick(): Promise<void>;
		hasFiles(data?: unknown): boolean;
		insert(data?: unknown): Promise<void>;
		enterDrag(): boolean;
		leaveDrag(): boolean;
		resetDrag(): void;
	};
	messageScroll: {
		captureAnchor(): boolean;
		restoreAnchor(): void;
		scrollBottom(behavior?: "auto" | "smooth"): void;
	};
	pickers: {
		isFileOpen(): boolean;
		isOpen(): boolean;
	};
	promptHistory: {
		handleInput(): void;
		handleKeydown(event: KeyboardEvent, entries: readonly string[]): boolean;
	};
	workspaceReview: {
		isOpen(): boolean;
		setOpen(open: boolean): void;
		toggle(): void;
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
