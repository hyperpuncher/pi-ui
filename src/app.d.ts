interface PiUiNamespace {
	basecoat: {
		refresh(root?: unknown): void;
	};
	dialogs: {
		toggleSession(): boolean;
		openTree(): void;
		openWorkspace(): void;
	};
	fileTransfer: {
		hasFiles(data?: unknown): boolean;
		insert(data?: unknown): Promise<void>;
		enterDrag(): boolean;
		leaveDrag(): boolean;
		resetDrag(): void;
	};
	messageScroll: {
		captureAnchor(): boolean;
		restoreAnchor(): void;
		scrollBottom(): void;
	};
	pickers: {
		isFileOpen(): boolean;
		isOpen(): boolean;
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
