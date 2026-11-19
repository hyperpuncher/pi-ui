import { copyText } from "#static/app/code-copy.js";

const maxPageHeight = 12_000;
const maxCopyLength = 256 * 1024;
const maxMeasuredHeights = 200;
// A remounted frame opens at the height its page last reported, before the page loads.
const measuredHeights = new Map();

// App tokens the page reads. The frame CSS aliases --surface and --accent.
const themeTokens = [
	"--text",
	"--text-muted",
	"--surface-control",
	"--border",
	"--action-primary",
	"--radius",
	"--font-sans",
	"--font-mono",
	...Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`),
];

function pageFrames() {
	return document.querySelectorAll("iframe.html-page");
}

function rememberHeight(src, pixels) {
	if (!src) return;
	measuredHeights.delete(src);
	measuredHeights.set(src, pixels);
	if (measuredHeights.size > maxMeasuredHeights) {
		const oldest = measuredHeights.keys().next().value;
		if (oldest !== undefined) measuredHeights.delete(oldest);
	}
}

/** Reads the live app tokens. Values keep light-dark(), which the page resolves. */
function readTheme() {
	const root = getComputedStyle(document.documentElement);
	const vars = Object.fromEntries(
		themeTokens.map((token) => [token, root.getPropertyValue(token).trim()]),
	);
	return { colorScheme: root.colorScheme, vars };
}

function sendTheme(frames, theme = readTheme()) {
	for (const frame of frames)
		frame.contentWindow?.postMessage({ piUiTheme: theme }, "*");
}

function canActForFrame(frame) {
	return document.activeElement === frame && navigator.userActivation.isActive;
}

// Require focus in the sending frame and recent user activation.
function openLink(frame, value) {
	if (!canActForFrame(frame)) return;
	const url = URL.parse(String(value));
	if (url?.protocol === "https:" || url?.protocol === "http:") {
		window.open(url, "_blank", "noopener,noreferrer");
	}
}

async function copyFromFrame(frame, request) {
	const id = request?.id;
	const text = request?.text === undefined ? "" : String(request.text);
	const ok =
		canActForFrame(frame) &&
		text.length > 0 &&
		text.length <= maxCopyLength &&
		(await copyText(text));
	frame.contentWindow?.postMessage({ piUiCopyResult: { id, ok } }, "*");
}

/** Sizes agent page frames, syncs the app's theme, and handles links and clipboard copy. */
export function bindHtmlPages() {
	window.addEventListener("message", (event) => {
		const frame = [...pageFrames()].find(
			(item) => item.contentWindow === event.source,
		);
		if (!frame) return;
		const src = frame.getAttribute("src");
		if (event.data?.piUiPageReady) {
			sendTheme([frame]);
			// A page that reloaded gets its remembered height before it measures again.
			const remembered = measuredHeights.get(src);
			if (remembered && frame.style.height !== remembered)
				frame.style.height = remembered;
		}
		if (event.data?.piUiOpenLink) openLink(frame, event.data.piUiOpenLink);
		if (event.data?.piUiCopyText) void copyFromFrame(frame, event.data.piUiCopyText);
		const height = Number(event.data?.piUiPageHeight);
		if (Number.isFinite(height) && height > 0) {
			const pixels = `${Math.min(maxPageHeight, Math.ceil(height))}px`;
			rememberHeight(src, pixels);
			// The first size eases in from the placeholder. A page that keeps resizing snaps, so the
			// transition cannot restart forever and hold the transcript in continuous layout.
			if (frame.hasAttribute("data-sized")) frame.style.transition = "none";
			else frame.setAttribute("data-sized", "");
			if (frame.style.height !== pixels) frame.style.height = pixels;
		}
	});
	// Scheme, font and theme token changes all land on these two attributes.
	const observer = new MutationObserver(() => {
		const frames = pageFrames();
		if (frames.length) sendTheme(frames);
	});
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["style"],
	});
	const scheme = document.querySelector('meta[name="color-scheme"]');
	if (scheme)
		observer.observe(scheme, { attributes: true, attributeFilter: ["content"] });
}
