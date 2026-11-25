const styles = new Map();
const activeLines = new Map();
let sheet;
let scheduled = false;

function ensureHighlight(declaration) {
	let highlight = styles.get(declaration);
	if (highlight) return highlight;
	if (!sheet) {
		sheet = new CSSStyleSheet();
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
	}
	const name = `pi-hl-${styles.size}`;
	try {
		sheet.insertRule(`::highlight(${name}) { ${declaration} }`);
	} catch {
		return undefined;
	}
	highlight = new Highlight();
	CSS.highlights.set(name, highlight);
	styles.set(declaration, highlight);
	return highlight;
}

function clearLine(line) {
	const prev = activeLines.get(line);
	if (!prev) return;
	for (const [highlight, range] of prev.ranges) {
		highlight.delete(range);
	}
	activeLines.delete(line);
}

function buildRanges(hl, textNode, paletteList) {
	const length = textNode.length;
	const ranges = [];
	for (let pos = 0; pos < hl.length;) {
		const c1 = hl.indexOf(":", pos);
		const c2 = c1 === -1 ? -1 : hl.indexOf(":", c1 + 1);
		if (c2 === -1) break;
		const comma = hl.indexOf(",", c2 + 1);
		const endPos = comma === -1 ? hl.length : comma;
		const decl = paletteList[Number(hl.slice(pos, c1))];
		const start = Number(hl.slice(c1 + 1, c2));
		const end = Number(hl.slice(c2 + 1, endPos));
		pos = endPos + 1;
		if (!decl || !(start >= 0 && end > start && end <= length)) continue;
		const highlight = ensureHighlight(decl);
		if (!highlight) continue;
		const range = new StaticRange({
			startContainer: textNode,
			startOffset: start,
			endContainer: textNode,
			endOffset: end,
		});
		highlight.add(range);
		ranges.push([highlight, range]);
	}
	return ranges;
}

function applyLine(line, palette, paletteList) {
	const hl = line.getAttribute("data-hl");
	const textNode = line.firstChild;
	if (!hl || !(textNode instanceof Text)) {
		clearLine(line);
		return;
	}
	const length = textNode.length;
	const prev = activeLines.get(line);
	if (
		prev &&
		prev.hl === hl &&
		prev.palette === palette &&
		prev.textNode === textNode &&
		prev.length === length
	) {
		return;
	}
	clearLine(line);
	const ranges = buildRanges(hl, textNode, paletteList);
	if (ranges.length) activeLines.set(line, { hl, palette, textNode, length, ranges });
}

function syncContainer(container) {
	const palette = container.getAttribute("data-hl-palette");
	if (!palette) return;
	const paletteList = palette.split("|");
	if (container.hasAttribute("data-hl")) {
		applyLine(container, palette, paletteList);
		return;
	}
	for (const line of container.querySelectorAll("[data-hl]")) {
		applyLine(line, palette, paletteList);
	}
}

function syncCodeHighlights() {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	for (const line of activeLines.keys()) {
		if (!line.isConnected || !line.hasAttribute("data-hl")) clearLine(line);
	}
	const root = document.getElementById("app") ?? document.body;
	if (!root) return;
	for (const container of root.querySelectorAll("[data-hl-palette]")) {
		syncContainer(container);
	}
}

function hasHighlightNode(nodes) {
	for (const node of nodes) {
		if (!(node instanceof Element)) continue;
		if (
			node.hasAttribute("data-hl") ||
			node.hasAttribute("data-hl-palette") ||
			node.querySelector("[data-hl], [data-hl-palette]")
		) {
			return true;
		}
	}
	return false;
}

function isRelevantMutation(records) {
	for (const record of records) {
		if (record.type === "attributes") return true;
		if (
			record.target instanceof Element &&
			record.target.closest("[data-hl], [data-hl-palette]")
		) {
			return true;
		}
		if (
			hasHighlightNode(record.addedNodes) ||
			hasHighlightNode(record.removedNodes)
		) {
			return true;
		}
	}
	return false;
}

function scheduleSync(records) {
	if (scheduled || (records && !isRelevantMutation(records))) return;
	scheduled = true;
	queueMicrotask(() => {
		scheduled = false;
		syncCodeHighlights();
	});
}

export function bindCodeHighlights() {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	syncCodeHighlights();
	const root = document.getElementById("app") ?? document.body;
	if (!root) return;
	const observer = new MutationObserver(scheduleSync);
	observer.observe(root, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["data-hl", "data-hl-palette"],
	});
}
