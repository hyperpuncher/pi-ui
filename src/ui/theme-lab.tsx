import { Icon } from "./icon.tsx";
import { RotateCcw, X } from "./icons.ts";

const paletteGroups = [
	{
		label: "surfaces",
		tokens: [
			["surfaceBase", "base"],
			["surfaceCanvas", "canvas"],
			["surfacePane", "pane"],
			["surfaceRaised", "raised"],
			["surfaceMuted", "muted"],
			["surfaceControl", "control"],
			["surfaceCode", "code"],
		],
	},
	{
		label: "tree roles",
		tokens: [
			["treeUser", "user"],
			["treeAssistant", "assistant"],
			["treeTool", "tools"],
			["treeSummary", "summary"],
		],
	},
	{
		label: "text",
		tokens: [
			["text", "primary"],
			["textMuted", "muted"],
		],
	},
	{
		label: "interaction and status",
		tokens: [
			["actionPrimary", "primary action"],
			["actionPrimaryText", "action text"],
			["border", "border"],
			["focusRing", "focus"],
			["selection", "selection"],
			["statusDanger", "destructive"],
			["statusWarning", "warning and cache miss"],
		],
	},
] as const;

const paletteNames = [
	"surfaceBase",
	"surfaceCanvas",
	"surfacePane",
	"surfaceRaised",
	"surfaceMuted",
	"surfaceControl",
	"surfaceCode",
	"treeUser",
	"treeAssistant",
	"treeTool",
	"treeSummary",
	"text",
	"textMuted",
	"actionPrimary",
	"actionPrimaryText",
	"border",
	"focusRing",
	"selection",
	"statusDanger",
	"statusWarning",
] as const;

const metricGroups = [
	{
		label: "Typography",
		metrics: [
			["textXs", "Text xs", 10, 16, 1, "px"],
			["textSm", "Text sm", 11, 18, 1, "px"],
			["textBase", "Text base", 12, 20, 1, "px"],
			["textLg", "Text lg", 14, 24, 1, "px"],
		],
	},
	{
		label: "Spacing",
		metrics: [
			["messageGap", "Messages", 8, 48, 1, "px"],
			["messageUserGap", "User message", 0, 24, 1, "px"],
			["messageToolGap", "Tool calls", 4, 32, 1, "px"],
			["messageNarrativeGap", "Tool narrative", 4, 32, 1, "px"],
			["workspaceGap", "Workspace gap", 0, 12, 1, "px"],
			["workspaceInset", "Workspace inset", 0, 12, 1, "px"],
		],
	},
	{
		label: "Layout",
		metrics: [
			["messagesMaxWidth", "Messages width", 480, 1120, 16, "px"],
			["promptMaxWidth", "Prompt width", 480, 1120, 16, "px"],
			["reviewToolbarHeight", "Review toolbar", 28, 48, 1, "px"],
		],
	},
] as const;

const shadowMetrics = [
	["shadowSm", "Shadow sm"],
	["shadowMd", "Shadow md"],
	["shadowLg", "Shadow lg"],
	["shadowXl", "Shadow xl"],
] as const;

const metricNames = [
	"textXs",
	"textSm",
	"textBase",
	"textLg",
	"messageGap",
	"messageUserGap",
	"messageToolGap",
	"messageNarrativeGap",
	"workspaceGap",
	"workspaceInset",
	"messagesMaxWidth",
	"promptMaxWidth",
	"reviewToolbarHeight",
	"shadowSm",
	"shadowMd",
	"shadowLg",
	"shadowXl",
] as const;

type ThemeMode = "light" | "dark";
type ThemePreference = "system" | ThemeMode;
type PaletteName = (typeof paletteNames)[number];
type MetricName = (typeof metricNames)[number];

function tokenDescription(name: PaletteName): string | undefined {
	switch (name) {
		case "surfaceBase":
			return "body and selected control surface";
		case "surfaceCanvas":
			return "space surrounding workspace panes";
		case "surfacePane":
			return "chat, sidebar, review, and diff panes";
		case "surfaceRaised":
			return "cards, dialogs, menus, popovers, and the composer";
		case "statusDanger":
			return "destructive actions and invalid controls";
		case "statusWarning":
			return "warnings and cache-miss notices";
		default:
			return undefined;
	}
}

function signalName(mode: ThemeMode, name: PaletteName): string {
	return `themeLab${mode === "light" ? "Light" : "Dark"}${name[0]?.toUpperCase()}${name.slice(1)}`;
}

function signal(mode: ThemeMode, name: PaletteName): string {
	return `$${signalName(mode, name)}`;
}

function paletteExpression(mode: ThemeMode): string {
	return `{${paletteNames.map((name) => `${name}: ${signal(mode, name)}`).join(",")}}`;
}

function allPalettesExpression(): string {
	return `{light:${paletteExpression("light")},dark:${paletteExpression("dark")}}`;
}

function metricSignalName(name: MetricName): string {
	return `themeLab${name[0]?.toUpperCase()}${name.slice(1)}`;
}

function metricSignal(name: MetricName): string {
	return `$${metricSignalName(name)}`;
}

function metricsExpression(): string {
	return `{${metricNames.map((name) => `${name}: ${metricSignal(name)}`).join(",")}}`;
}

function restoreExpression(): string {
	const assignments = paletteNames.flatMap((name) => [
		`${signal("light", name)} = saved.light.${name};`,
		`${signal("dark", name)} = saved.dark.${name};`,
	]);
	return `const saved = window.piUi.themeLab.restore();
		${assignments.join("\n")}
		${metricNames.map((name) => `${metricSignal(name)} = saved.metrics.${name};`).join("\n")}
		$themeLabPreference = window.piUi.themeLab.currentPreference();
		$themeLabMode = window.piUi.themeLab.currentMode();
		$themeLabRadius = saved.radius;
		$themeLabReady = true;`;
}

function resetExpression(): string {
	const assignments = paletteNames.map(
		(name) =>
			`${signal("light", name)} = reset.light.${name}; ${signal("dark", name)} = reset.dark.${name};`,
	);
	return `const reset = window.piUi.themeLab.reset(); ${assignments.join(" ")} ${metricNames.map((name) => `${metricSignal(name)} = reset.metrics.${name};`).join(" ")} $themeLabRadius = reset.radius;`;
}

function renderToken(mode: ThemeMode, name: PaletteName, label: string) {
	const boundSignal = signalName(mode, name);
	const value = signal(mode, name);
	return (
		<div
			class="theme-lab-token"
			data-class:theme-lab-modified={`window.piUi.themeLab.changedColor('${mode}', '${name}', ${value})`}
			data-on:dblclick={`if (!evt.target.closest('input')) ${value} = window.piUi.themeLab.defaultColor('${mode}', '${name}')`}
			title={tokenDescription(name)}
		>
			<span class="theme-lab-swatch-wrap">
				<input
					class="theme-lab-swatch-input"
					type="color"
					aria-label={`${label} color`}
					data-effect={`
						$themeLabMode;
						el.value = window.piUi.themeLab.toHex(${value}, ${signal(mode, "surfaceBase")});
					`}
					data-on:input={`${value} = evt.target.value`}
				/>
				<span class="theme-lab-swatch" data-style:background={value} />
			</span>
			<span class="theme-lab-token-label">{label}</span>
			<input
				class="theme-lab-value"
				type="text"
				spellcheck="false"
				aria-label={`${label} CSS color`}
				data-bind={boundSignal}
				data-class:theme-lab-value-invalid={`!window.piUi.themeLab.valid(${value})`}
			/>
		</div>
	);
}

function renderPalette(mode: ThemeMode) {
	return (
		<div class="theme-lab-palette" data-show={`$themeLabMode === '${mode}'`}>
			{paletteGroups.map((group) => (
				<details class="theme-lab-group" open>
					<summary>{group.label}</summary>
					<div class="theme-lab-token-list">
						{group.tokens.map(([name, label]) =>
							renderToken(mode, name, label),
						)}
					</div>
				</details>
			))}
		</div>
	);
}

function renderMetric(
	name: MetricName,
	label: string,
	minimum: number,
	maximum: number,
	step: number,
	unit: string,
) {
	const boundSignal = metricSignalName(name);
	const value = metricSignal(name);
	return (
		<label
			class="theme-lab-metric"
			data-class:theme-lab-modified={`window.piUi.themeLab.changedMetric('${name}', ${value})`}
			data-on:dblclick={`if (!evt.target.closest('input')) ${value} = window.piUi.themeLab.defaultMetric('${name}')`}
		>
			<span>{label}</span>
			<input
				type="range"
				min={String(minimum)}
				max={String(maximum)}
				step={String(step)}
				data-bind={boundSignal}
			/>
			<output data-text={`${value} + '${unit}'`} />
		</label>
	);
}

function renderMetrics() {
	return (
		<div
			class="theme-lab-metrics"
			role="tabpanel"
			data-show="$themeLabSection === 'metrics'"
		>
			<details class="theme-lab-group" open>
				<summary>Shape</summary>
				<div class="theme-lab-metric-list">
					<label
						class="theme-lab-metric"
						data-class:theme-lab-modified="window.piUi.themeLab.changedRadius($themeLabRadius)"
						data-on:dblclick="if (!evt.target.closest('input')) $themeLabRadius = window.piUi.themeLab.defaultRadius()"
					>
						<span>radius</span>
						<input
							type="range"
							min="0"
							max="18"
							step="1"
							data-bind:theme-lab-radius
						/>
						<output data-text="$themeLabRadius + 'px'" />
					</label>
				</div>
			</details>
			{metricGroups.map((group) => (
				<details class="theme-lab-group" open>
					<summary>{group.label}</summary>
					<div class="theme-lab-metric-list">
						{group.metrics.map(
							([name, label, minimum, maximum, step, unit]) =>
								renderMetric(name, label, minimum, maximum, step, unit),
						)}
					</div>
				</details>
			))}
			<details class="theme-lab-group">
				<summary>Shadows</summary>
				<div class="theme-lab-shadow-list">
					{shadowMetrics.map(([name, label]) => (
						<label
							class="theme-lab-shadow"
							data-class:theme-lab-modified={`window.piUi.themeLab.changedMetric('${name}', ${metricSignal(name)})`}
						>
							<span>{label}</span>
							<input
								type="text"
								spellcheck="false"
								data-bind={metricSignalName(name)}
							/>
						</label>
					))}
				</div>
			</details>
		</div>
	);
}

export function renderThemeLab(): JSX.Element {
	const initialSignals = {
		themeLabOpen: false,
		themeLabMode: "light",
		themeLabPreference: "system",
		themeLabSection: "colors",
		themeLabReady: false,
		themeLabRadius: 10,
		...Object.fromEntries(
			paletteNames.flatMap((name) => [
				[signalName("light", name), "transparent"],
				[signalName("dark", name), "transparent"],
			]),
		),
		...Object.fromEntries(
			metricNames.map((name) => [
				metricSignalName(name),
				name.startsWith("shadow") ? "" : 0,
			]),
		),
	};
	const activePalette = `$themeLabMode === 'light' ? ${paletteExpression("light")} : ${paletteExpression("dark")}`;

	return (
		<aside
			id="theme-lab"
			class="theme-lab"
			aria-label="Theme lab"
			data-signals={JSON.stringify(initialSignals)}
			data-init={restoreExpression()}
			data-on:pi-ui-theme-mode-changed__window="
				$themeLabPreference = window.piUi.themeLab.currentPreference();
				$themeLabMode = window.piUi.themeLab.currentMode();
			"
			data-effect={`if ($themeLabReady) window.piUi.themeLab.apply($themeLabMode, ${activePalette}, $themeLabRadius, ${metricsExpression()}, ${allPalettesExpression()})`}
		>
			<button
				type="button"
				class="theme-lab-launcher"
				data-show="!$themeLabOpen"
				data-on:click="$themeLabOpen = true"
				aria-label="Open theme lab"
			>
				Theme Lab
			</button>
			<section class="theme-lab-panel" data-show="$themeLabOpen">
				<header class="theme-lab-header">
					<strong>theme lab</strong>
					<button
						type="button"
						class="theme-lab-icon-button"
						data-on:click="$themeLabOpen = false"
						aria-label="Close theme lab"
					>
						<Icon icon={X} />
					</button>
				</header>

				<div class="theme-lab-tabbar">
					<div
						class="theme-lab-section-tabs"
						role="tablist"
						aria-label="Theme lab section"
					>
						<button
							type="button"
							role="tab"
							data-attr:aria-selected="$themeLabSection === 'colors'"
							data-class:theme-lab-tab-active="$themeLabSection === 'colors'"
							data-on:click="$themeLabSection = 'colors'"
						>
							colors
						</button>
						<button
							type="button"
							role="tab"
							data-attr:aria-selected="$themeLabSection === 'metrics'"
							data-class:theme-lab-tab-active="$themeLabSection === 'metrics'"
							data-on:click="$themeLabSection = 'metrics'"
						>
							metrics
						</button>
					</div>
					<div class="theme-lab-mode" role="tablist" aria-label="Preview theme">
						{(
							[
								["system", "system"],
								["light", "light"],
								["dark", "black"],
							] satisfies readonly (readonly [ThemePreference, string])[]
						).map(([preference, label]) => (
							<button
								type="button"
								role="tab"
								data-attr:aria-selected={`$themeLabPreference === '${preference}' ? 'true' : 'false'`}
								data-class:theme-lab-tab-active={`$themeLabPreference === '${preference}'`}
								data-on:click={`
									$themeLabPreference = '${preference}';
									window.piUi.themeLab.setMode('${preference}');
									$themeLabMode = window.piUi.themeLab.currentMode();
								`}
							>
								{label}
							</button>
						))}
					</div>
				</div>

				<div class="theme-lab-scroll">
					<div role="tabpanel" data-show="$themeLabSection === 'colors'">
						{renderPalette("light")}
						{renderPalette("dark")}
					</div>
					{renderMetrics()}
				</div>

				<footer class="theme-lab-footer">
					<button
						type="button"
						class="theme-lab-icon-button"
						data-on:click={resetExpression()}
						aria-label="Reset theme"
					>
						<Icon icon={RotateCcw} />
					</button>
					<div class="theme-lab-actions">
						<button
							type="button"
							class="theme-lab-secondary-action"
							data-on:click={`window.piUi.themeLab.copy(${allPalettesExpression()}, $themeLabRadius, ${metricsExpression()}, el)`}
						>
							copy
						</button>
						<button
							type="button"
							class="theme-lab-primary-action"
							data-on:click={`window.piUi.themeLab.save(${allPalettesExpression()}, $themeLabRadius, ${metricsExpression()})`}
						>
							save
						</button>
					</div>
				</footer>
			</section>
		</aside>
	);
}
