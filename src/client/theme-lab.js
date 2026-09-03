const storageKey = "pi-ui-theme-lab-v5";
const canvas = document.createElement("canvas");
canvas.width = 1;
canvas.height = 1;
const context = canvas.getContext("2d", { willReadFrequently: true });

function currentMode() {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function currentPreference() {
	try {
		const stored = localStorage.getItem("themeMode");
		return stored === "light" || stored === "dark" ? stored : "system";
	} catch {
		return "system";
	}
}

function setMode(preference) {
	try {
		if (preference === "system") localStorage.removeItem("themeMode");
		else localStorage.setItem("themeMode", preference);
	} catch {
		// Theme editing still works when storage is unavailable.
	}
	const dark =
		preference === "dark" ||
		(preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("dark", dark);
	window.dispatchEvent(new Event("pi-ui-theme-mode-changed"));
}

function resolveColor(color) {
	const value = String(color).trim();
	if (!CSS.supports("color", value)) return undefined;
	for (const [, property] of value.matchAll(/var\((--[\w-]+)/g)) {
		if (!getComputedStyle(document.documentElement).getPropertyValue(property)) {
			return undefined;
		}
	}
	const probe = document.createElement("span");
	probe.style.color = value;
	probe.style.position = "fixed";
	probe.style.visibility = "hidden";
	document.documentElement.append(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	return resolved;
}

function valid(color) {
	return Boolean(resolveColor(color));
}

function toRgb(color, background = "oklch(100% 0 none)") {
	if (!context) return [0, 0, 0, 1];
	const resolvedColor = resolveColor(color);
	const resolvedBackground = resolveColor(background);
	if (!resolvedColor || !resolvedBackground) return [0, 0, 0, 1];
	context.clearRect(0, 0, 1, 1);
	context.fillStyle = resolvedBackground;
	context.fillRect(0, 0, 1, 1);
	context.fillStyle = resolvedColor;
	context.fillRect(0, 0, 1, 1);
	const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
	return [red, green, blue, alpha / 255];
}

function toHex(color, background) {
	const [red, green, blue] = toRgb(color, background);
	return `#${[red, green, blue]
		.map((channel) => channel.toString(16).padStart(2, "0"))
		.join("")}`;
}

function paletteValue(palette, name) {
	const value = palette[name];
	return valid(value) ? value : undefined;
}

function setProperties(names, value) {
	for (const name of names) {
		if (value) document.documentElement.style.setProperty(`--${name}`, value);
		else document.documentElement.style.removeProperty(`--${name}`);
	}
}

const sourceProperties = {
	surfaceBase: "surface-base",
	surfaceCanvas: "surface-canvas",
	surfacePane: "surface-pane",
	surfaceRaised: "surface-raised",
	surfaceMuted: "surface-muted",
	surfaceControl: "surface-control",
	surfaceCode: "surface-code",
	treeUser: "tree-user",
	treeAssistant: "tree-assistant",
	treeTool: "tree-tool",
	treeSummary: "tree-summary",
	text: "text",
	textMuted: "text-muted",
	actionPrimary: "action-primary",
	actionPrimaryText: "action-primary-text",
	border: "border",
	focusRing: "focus-ring",
	selection: "selection",
	statusDanger: "status-danger",
	statusWarning: "status-warning",
};

const metricProperties = {
	textXs: "text-xs",
	textSm: "text-sm",
	textBase: "text-base",
	textLg: "text-lg",
	messageGap: "message-gap",
	messageUserGap: "message-user-gap",
	messageToolGap: "message-tool-gap",
	messageNarrativeGap: "message-tool-narrative-gap",
	workspaceGap: "workspace-gap",
	workspaceInset: "workspace-inset",
	messagesMaxWidth: "messages-max-width",
	promptMaxWidth: "prompt-max-width",
	reviewToolbarHeight: "review-toolbar-height",
	shadowSm: "shadow-sm",
	shadowMd: "shadow-md",
	shadowLg: "shadow-lg",
	shadowXl: "shadow-xl",
};

const aliases = Object.fromEntries(
	Object.entries(sourceProperties).map(([name, property]) => [name, [property]]),
);

function apply(mode, palette, radius, metrics, palettes) {
	const changed = new Set(
		Object.keys(aliases).filter((name) => palette[name] !== defaults[mode][name]),
	);
	for (const [name, names] of Object.entries(aliases)) {
		setProperties(names, changed.has(name) ? paletteValue(palette, name) : undefined);
	}
	if (Number.isFinite(Number(radius)) && Number(radius) !== defaults.radius) {
		document.documentElement.style.setProperty("--radius", `${radius}px`);
	} else {
		document.documentElement.style.removeProperty("--radius");
	}

	for (const [name, property] of Object.entries(metricProperties)) {
		const changedMetric = metrics[name] !== defaults.metrics[name];
		const value = name.startsWith("shadow") ? metrics[name] : `${metrics[name]}px`;
		setProperties([property], changedMetric ? value : undefined);
	}

	try {
		const overrides = (values, baseline) =>
			Object.fromEntries(
				Object.entries(values).filter(
					([name, value]) => value !== baseline[name],
				),
			);
		const stored = {
			light: overrides(palettes.light, defaults.light),
			dark: overrides(palettes.dark, defaults.dark),
			metrics: overrides(metrics, defaults.metrics),
		};
		if (Number(radius) !== defaults.radius) stored.radius = Number(radius);
		localStorage.setItem(storageKey, JSON.stringify(stored));
	} catch {
		// Live editing remains available without persistence.
	}
}

function readAuthoredValues() {
	const light = {};
	const darkOverrides = {};
	const collect = (style, target) => {
		for (const property of [
			...Object.values(sourceProperties),
			...Object.values(metricProperties),
		]) {
			const value = style.getPropertyValue(`--${property}`).trim();
			if (value) target[property] = value;
		}
	};
	const visit = (rules) => {
		for (const rule of rules) {
			if (rule.style && rule.selectorText) {
				const selectors = rule.selectorText
					.split(",")
					.map((value) => value.trim());
				if (selectors.includes(":root")) collect(rule.style, light);
				if (selectors.includes("html.dark")) collect(rule.style, darkOverrides);
			}
			if (rule.cssRules) visit(rule.cssRules);
		}
	};
	for (const sheet of document.styleSheets) {
		try {
			visit(sheet.cssRules);
		} catch {
			// Cross-origin stylesheets cannot expose their authored declarations.
		}
	}
	return { light, dark: { ...light, ...darkOverrides } };
}

function readPalette(authored) {
	const styles = getComputedStyle(document.documentElement);
	return Object.fromEntries(
		Object.entries(sourceProperties).map(([name, property]) => [
			name,
			authored[property] ?? styles.getPropertyValue(`--${property}`).trim(),
		]),
	);
}

function readMetrics(authored) {
	const styles = getComputedStyle(document.documentElement);
	const probe = document.createElement("span");
	probe.style.position = "fixed";
	probe.style.visibility = "hidden";
	document.documentElement.append(probe);
	const metrics = Object.fromEntries(
		Object.entries(metricProperties).map(([name, property]) => {
			const value =
				authored[property] ?? styles.getPropertyValue(`--${property}`).trim();
			if (name.startsWith("shadow")) return [name, value];
			probe.style.width = value;
			return [name, Number.parseFloat(getComputedStyle(probe).width)];
		}),
	);
	probe.remove();
	return metrics;
}

function readDefaults() {
	const root = document.documentElement;
	const authored = readAuthoredValues();
	const wasDark = root.classList.contains("dark");
	root.classList.remove("dark");
	const light = readPalette(authored.light);
	root.classList.add("dark");
	const dark = readPalette(authored.dark);
	root.classList.toggle("dark", wasDark);

	const probe = document.createElement("span");
	probe.style.position = "fixed";
	probe.style.width = "var(--radius)";
	probe.style.visibility = "hidden";
	root.append(probe);
	const radius = Number.parseFloat(getComputedStyle(probe).width) || 10;
	probe.remove();
	return { light, dark, radius, metrics: readMetrics(authored.light) };
}

const defaults = readDefaults();

function defaultColor(mode, name) {
	return defaults[mode][name];
}

function defaultMetric(name) {
	return defaults.metrics[name];
}

function defaultRadius() {
	return defaults.radius;
}

function changedColor(mode, name, value) {
	return value !== defaults[mode][name];
}

function changedMetric(name, value) {
	return value !== defaults.metrics[name];
}

function changedRadius(value) {
	return Number(value) !== defaults.radius;
}

function restore() {
	const fallback = structuredClone(defaults);
	try {
		const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null");
		if (!stored || Object.prototype.toString.call(stored) !== "[object Object]") {
			return fallback;
		}
		for (const mode of ["light", "dark"]) {
			for (const name of Object.keys(defaults[mode])) {
				const value = stored[mode]?.[name];
				if (valid(value)) fallback[mode][name] = value;
			}
		}
		if (Number.isFinite(Number(stored.radius)))
			fallback.radius = Number(stored.radius);
		for (const name of Object.keys(defaults.metrics)) {
			const value = stored.metrics?.[name];
			if (name.startsWith("shadow")) {
				if (CSS.supports("box-shadow", String(value)))
					fallback.metrics[name] = value;
			} else if (Number.isFinite(Number(value))) {
				fallback.metrics[name] = Number(value);
			}
		}
	} catch {
		// Ignore malformed or unavailable saved state.
	}
	return fallback;
}

function reset() {
	try {
		localStorage.removeItem(storageKey);
	} catch {
		// The returned defaults still reset the current page.
	}
	return structuredClone(defaults);
}

function cssName(name) {
	return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function themeCss(palettes, radius, metrics) {
	const metricLines = Object.entries(metrics).map(([name, value]) => {
		const property = metricProperties[name];
		return `\t--${property}: ${name.startsWith("shadow") ? value : `${value}px`};`;
	});
	const block = (palette, foundations = []) =>
		Object.entries(palette)
			.map(([name, value]) => `\t--${cssName(name)}: ${value};`)
			.concat(foundations)
			.join("\n");
	return `:root {\n${block(palettes.light, [`\t--radius: ${radius}px;`, ...metricLines])}\n}\n\nhtml.dark {\n${block(palettes.dark)}\n\tcolor-scheme: dark;\n}`;
}

async function copy(palettes, radius, metrics, button) {
	const css = themeCss(palettes, radius, metrics);
	if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(css);
	else {
		const textarea = document.createElement("textarea");
		textarea.value = css;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.append(textarea);
		textarea.select();
		document.execCommand("copy");
		textarea.remove();
	}
	if (!(button instanceof HTMLButtonElement)) return;
	const previous = button.textContent;
	button.textContent = "Copied";
	setTimeout(() => {
		button.textContent = previous;
	}, 1200);
}

function save(palettes, radius, metrics) {
	const blob = new Blob([themeCss(palettes, radius, metrics)], { type: "text/css" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "pi-ui-theme.css";
	anchor.click();
	URL.revokeObjectURL(url);
}

window.piUi.themeLab = {
	apply,
	changedColor,
	changedMetric,
	changedRadius,
	copy,
	currentMode,
	currentPreference,
	defaultColor,
	defaultMetric,
	defaultRadius,
	reset,
	restore,
	save,
	setMode,
	toHex,
	valid,
};
