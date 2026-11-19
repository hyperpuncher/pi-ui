// Keep bridge names local so they cannot collide with the page's scripts.
(() => {
	const root = document.documentElement;
	let copySeq = 0;
	const pendingCopies = new Map();
	// Bridge navigator.clipboard.writeText through the host because opaque-origin sandboxes block it.
	const writeText = (text) =>
		new Promise((resolve, reject) => {
			const id = ++copySeq;
			pendingCopies.set(id, { resolve, reject });
			parent.postMessage({ piUiCopyText: { id, text: String(text) } }, "*");
			setTimeout(() => {
				const pending = pendingCopies.get(id);
				if (!pending) return;
				pendingCopies.delete(id);
				pending.reject(
					new DOMException("Clipboard write timed out", "NotAllowedError"),
				);
			}, 1000);
		});
	if (navigator.clipboard) {
		Object.defineProperty(navigator.clipboard, "writeText", {
			configurable: true,
			value: writeText,
		});
	} else {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
	}
	addEventListener("message", (event) => {
		if (event.source !== parent) return;
		const copyResult = event.data?.piUiCopyResult;
		if (copyResult && pendingCopies.has(copyResult.id)) {
			const pending = pendingCopies.get(copyResult.id);
			pendingCopies.delete(copyResult.id);
			if (copyResult.ok) pending.resolve();
			else
				pending.reject(
					new DOMException("Clipboard write blocked", "NotAllowedError"),
				);
			return;
		}
		const theme = event.data?.piUiTheme;
		if (!theme?.vars) return;
		root.style.colorScheme = String(theme.colorScheme);
		for (const [name, value] of Object.entries(theme.vars))
			root.style.setProperty(name, String(value));
	});
	let lastHeight = 0;
	const reportHeight = () => {
		// scrollHeight catches overflow; getBoundingClientRect lets the frame shrink.
		const height = Math.ceil(
			root.scrollHeight > root.clientHeight
				? root.scrollHeight
				: root.getBoundingClientRect().height,
		);
		if (height <= 0 || height === lastHeight) return;
		lastHeight = height;
		parent.postMessage({ piUiPageHeight: height }, "*");
	};
	const observer = new ResizeObserver(reportHeight);
	observer.observe(root, { box: "border-box" });
	document.addEventListener("DOMContentLoaded", () => {
		if (document.body) observer.observe(document.body, { box: "border-box" });
		reportHeight();
	});
	addEventListener("load", reportHeight);
	parent.postMessage({ piUiPageReady: true }, "*");
	// Forward trusted external HTTP(S) link clicks to the app; keep same-page anchors local.
	document.addEventListener(
		"click",
		(event) => {
			const link = event.composedPath().find((node) => node?.matches?.("a[href]"));
			if (
				!link ||
				!/^https?:$/.test(link.protocol) ||
				link.href.split("#")[0] === location.href.split("#")[0]
			)
				return;
			event.preventDefault();
			if (event.isTrusted) parent.postMessage({ piUiOpenLink: link.href }, "*");
		},
		true,
	);
})();
