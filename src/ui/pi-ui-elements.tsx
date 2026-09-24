import {
	isPiUiSheetElement,
	type PiUiAction,
	type PiUiElement,
	piUiDialogId,
	piUiDismissedStorageKey,
} from "../extension-surface-types.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import type { JsonObject, JsonValue } from "../utils/json-types.ts";
import { isBoolean, isJsonObject, isNumber, isString } from "../utils/type-guards.ts";
import { renderMarkdownStreaming } from "./markdown.tsx";
import { syncHtml } from "./sync-html.ts";

/**
 * Renders decoded "Pi UI Bridge" (PIUI) elements — the wire vocabulary
 * bridge-aware extensions emit over `ctx.ui.notify()` (see `pi-ui-bridge.ts`
 * and `~/.pi/agent/extensions/lib/bridge.ts`) — natively, by placement:
 *
 * - `status` → a status chip, same row as `ctx.ui.setStatus()`'s own chips.
 * - `pinned`/`inline` → the widget area above the editor (widget, roster,
 *   progress, log, markdown, diff).
 * - `sheet`/`screen` → a native `<dialog>` sheet (bottom sheet on mobile),
 *   with `actions`/fields (`panel`, `form`).
 * - `composer` → not rendered here; `ExtensionUiController` pushes its text
 *   straight into the prompt editor as a side effect of decoding.
 *
 * `renderPiUiElement()` is exported standalone so the Live Workspace pane
 * (R1-C) can reuse the same per-kind rendering for its Extensions tab.
 */

const widgetPlacements = new Set(["pinned", "inline"]);
/** Action ids the user's `lib/bridge.ts` consumers (ask-user.ts, btw.ts) listen on. */
const submitActionId = "submit";
const closeActionId = "close";

export function renderPiUiStatusChips(
	state: Pick<AppStateSnapshot, "extensionElements">,
): string {
	return syncHtml(
		<>
			{state.extensionElements
				.filter((element) => element.placement === "status")
				.map((element) => (
					<span
						class="extension-status piui-status"
						data-piui-element={domId(element)}
						safe
					>
						{textField(element.data.text) ?? element.title ?? ""}
					</span>
				))}
		</>,
	);
}

export function renderPiUiWidgets(
	state: Pick<AppStateSnapshot, "extensionElements">,
): string {
	const elements = state.extensionElements.filter(
		(element) =>
			widgetPlacements.has(element.placement) && element.kind !== "composer",
	);
	return syncHtml(
		<div id="piui-widgets" class="piui-widgets" aria-live="polite">
			{elements.length > 0 && (
				<>
					{/* Narrow screens (<= 64rem: the Live Workspace drawer/sheet range) hide
					 * `.piui-widgets-list` and show this one-line summary instead — the full
					 * strip ran 320–384px tall on a phone, about 40% of the screen (round-2
					 * audit m12). Tapping it opens the same content in the Live Workspace
					 * Extensions tab. */}
					{renderPiUiWidgetsSummary(elements)}
					<div class="piui-widgets-list">
						{elements.map((element) =>
							isPinnedSummaryKind(element)
								? renderPiUiPinnedSummary(element)
								: renderPiUiElement(element),
						)}
					</div>
				</>
			)}
		</div>,
	);
}

function renderPiUiWidgetsSummary(elements: readonly PiUiElement[]): string {
	const count = elements.length;
	const onlyTitle = count === 1 ? elements[0]?.title : undefined;
	const label = onlyTitle ?? `${count} extension update${count === 1 ? "" : "s"}`;
	return syncHtml(
		<button
			type="button"
			class="btn piui-widgets-summary"
			data-variant="ghost"
			data-size="sm"
			data-on:click={openLiveWorkspaceExtensionsAction()}
		>
			<span class="piui-widgets-summary-label" safe>
				{label}
			</span>
			<span class="badge piui-widgets-summary-count" data-variant="secondary" safe>
				{count}
			</span>
		</button>,
	);
}

/**
 * `pinned` `roster`/`progress` elements: a `roster` can carry many rows, and stacking every
 * one of them above the editor would make the widget area a tall list rather than the
 * compact strip the plan calls for. Show a one-line summary here instead (row count and how
 * many are `running`, or the progress bar/label — already one line) with a button to the full
 * detail, which keeps rendering unchanged in the Live Workspace Extensions tab
 * (`renderExtensionsTab`, live-workspace.tsx) via the same `renderPiUiElement`.
 */
function isPinnedSummaryKind(element: PiUiElement): boolean {
	return (
		element.placement === "pinned" &&
		(element.kind === "roster" || element.kind === "progress")
	);
}

function renderPiUiPinnedSummary(element: PiUiElement): string {
	return syncHtml(
		<div class="piui-element piui-summary" data-piui-element={domId(element)}>
			{element.title && (
				<div class="piui-element-title" safe>
					{element.title}
				</div>
			)}
			<div class="piui-summary-row">
				<div class="piui-summary-body">
					{element.kind === "roster"
						? renderRosterSummary(element)
						: renderProgress(element)}
				</div>
				<button
					type="button"
					class="btn"
					data-variant="ghost"
					data-size="xs"
					data-on:click={openLiveWorkspaceExtensionsAction()}
				>
					Open
				</button>
			</div>
		</div>,
	);
}

function renderRosterSummary(element: PiUiElement): string {
	const rows = arrayField(element.data);
	if (!rows) return renderGenericData(element.data);
	const running = rows.filter(
		(row) =>
			isJsonObject(row) &&
			(textField(row.state) ?? textField(row.status)) === "running",
	).length;
	return syncHtml(
		<span class="fine-print">
			{rows.length} item{rows.length === 1 ? "" : "s"}
			{running > 0 && ` · ${running} running`}
		</span>,
	);
}

/** Opens the Live Workspace pane to the Extensions tab, where the full element renders. */
function openLiveWorkspaceExtensionsAction(): string {
	return `$_liveWorkspaceOpen = true;
		$liveWorkspacePreferences.tab = 'extensions';
		document.body.dispatchEvent(new CustomEvent(
			'pi-ui-live-workspace-preferences',
			{ detail: { tab: 'extensions' } },
		));`;
}

export function renderPiUiSheets(
	state: Pick<AppStateSnapshot, "extensionElements">,
	// Only the page's own initial render (`page.tsx`) has a real per-tab client id to give
	// this; `data-init` never re-runs for the later dirty-region re-renders that also call
	// this (`UiRenderer`'s patches morph into the same `#piui-sheets` node), so they can leave
	// it unset (round-4 O4 — see `colorSchemeReportScript`).
	clientId?: string,
): string {
	return syncHtml(
		<div id="piui-sheets" data-init={colorSchemeReportScript(clientId)}>
			{state.extensionElements
				.filter(isPiUiSheetElement)
				.map((element) => renderPiUiSheetDialog(element))}
		</div>,
	);
}

/**
 * Reports the browser's real `prefers-color-scheme` to the server once per connection, and on
 * change, so `ExtensionUiController`'s `colorScheme()` — used for a terminal surface's real
 * `Theme` and `ctx.ui.theme` — reflects it instead of always defaulting to `"dark"` (round-2
 * audit m9). `data-init` only runs once per element, and `#piui-sheets` is mounted once per
 * page connection and never recreated by a later PIUI patch (same node, same id), so this
 * piggybacks on it rather than adding a dedicated always-empty host element.
 *
 * `clientId`, when given, is reported alongside the scheme so the server can track it per
 * connection instead of one shared last-writer-wins value (round-4 O4). It's the page's own
 * stable per-tab id (`page.tsx`'s `displayClientId`), the same one the stream connection and
 * display-refresh Hz reporting already send.
 */
function colorSchemeReportScript(clientId?: string): string {
	const clientIdLiteral = clientId ? JSON.stringify(clientId) : "undefined";
	const post = (expression: string) =>
		`@post('${endpoints.extensionUiColorScheme}', { payload: { colorScheme: ${expression}, clientId: ${clientIdLiteral} }, requestCancellation: 'disabled' })`;
	return `const mql = window.matchMedia('(prefers-color-scheme: dark)');
		${post("mql.matches ? 'dark' : 'light'")};
		mql.addEventListener('change', (evt) => { ${post("evt.matches ? 'dark' : 'light'")} });`;
}

/** Ids of `sheet`/`screen` elements currently present — used to auto-open new ones. */
export function piUiSheetIds(
	state: Pick<AppStateSnapshot, "extensionElements">,
): readonly string[] {
	return state.extensionElements
		.filter(isPiUiSheetElement)
		.map((element) => dialogId(element));
}

export function renderPiUiElement(element: PiUiElement): string {
	return syncHtml(
		<div
			class={`piui-element piui-element-${element.kind}`}
			data-piui-element={domId(element)}
		>
			{element.title && (
				<div class="piui-element-title" safe>
					{element.title}
				</div>
			)}
			{renderPiUiBody(element)}
			{renderPiUiActions(element)}
		</div>,
	);
}

function renderPiUiSheetDialog(element: PiUiElement): string {
	const body = renderPiUiBody(element);
	return syncHtml(
		<dialog
			id={dialogId(element)}
			class="dialog piui-sheet"
			aria-labelledby={`${dialogId(element)}-title`}
			closedby="any"
			data-preserve-attr="open"
			data-on:close={dismissAction(element)}
			data-init={sheetOpenFocusScript()}
		>
			{/* A `.dialog`'s single child is its panel (shared `.dialog > *` chrome). */}
			<div class="piui-sheet-panel">
				<header>
					<h2 id={`${dialogId(element)}-title`} safe>
						{element.title ?? element.ns}
					</h2>
				</header>
				{body || renderPiUiSheetEmptyState()}
				<footer>
					{!element.actions?.some((action) => action.id === closeActionId) && (
						<button
							type="button"
							class="btn"
							data-variant="outline"
							commandfor={dialogId(element)}
							command="close"
						>
							Close
						</button>
					)}
					{renderPiUiActions(element)}
				</footer>
			</div>
		</dialog>,
	);
}

function renderPiUiBody(element: PiUiElement): string {
	switch (element.kind) {
		case "status":
			return syncHtml(<span safe>{textField(element.data.text) ?? ""}</span>);
		case "widget":
			return renderWidgetLines(element.data.lines);
		case "log":
			return renderLines(element.data.lines, "piui-log-lines");
		case "progress":
			return renderProgress(element);
		case "roster":
			return renderRoster(element);
		case "markdown":
			return renderMarkdownBody(element);
		case "diff":
			return renderDiffBody(element);
		case "panel":
		case "form":
			return renderPanelBody(element);
		case "composer":
			return "";
	}
}

function renderLines(value: JsonValue | undefined, className: string): string {
	const lines = stringArray(value);
	if (lines.length === 0) return "";
	return syncHtml(
		<div class={className}>
			{lines.map((line) => (
				<div safe>{line}</div>
			))}
		</div>,
	);
}

/** Above this many lines, a `widget` element's lines start collapsed (round-2 audit's
 * "PIUI placement UX": the above-editor area must never become a tall stack). */
const widgetCollapseLineThreshold = 6;

function renderWidgetLines(value: JsonValue | undefined): string {
	const lines = stringArray(value);
	if (lines.length === 0) return "";
	const list = (
		<div class="piui-widget-lines">
			{lines.map((line) => (
				<div safe>{line}</div>
			))}
		</div>
	);
	if (lines.length <= widgetCollapseLineThreshold) return syncHtml(list);
	return syncHtml(
		<details class="piui-widget-lines-collapsible">
			<summary class="fine-print">{lines.length} lines</summary>
			{list}
		</details>,
	);
}

function renderProgress(element: PiUiElement): string {
	const current = numberField(element.data.current);
	const total = numberField(element.data.total);
	const percent = numberField(element.data.percent);
	const ratio =
		percent !== undefined
			? clampPercent(percent)
			: current !== undefined && total
				? clampPercent((current / total) * 100)
				: undefined;
	const label = textField(element.data.label);
	return syncHtml(
		<div class="piui-progress">
			{ratio !== undefined ? (
				<span class="piui-progress-track">
					<span class="piui-progress-value" style={`width: ${ratio}%`} />
				</span>
			) : (
				<span class="piui-progress-indeterminate" />
			)}
			{(label ?? (current !== undefined && total !== undefined)) && (
				<span class="piui-progress-label" safe>
					{label ?? `${current} / ${total}`}
				</span>
			)}
		</div>,
	);
}

function renderRoster(element: PiUiElement): string {
	const rows = arrayField(element.data);
	if (!rows) return renderGenericData(element.data);
	return syncHtml(
		<ul class="piui-roster">{rows.map((row) => renderRosterRow(element, row))}</ul>,
	);
}

function renderRosterRow(element: PiUiElement, row: JsonValue): string {
	if (!isJsonObject(row)) {
		return syncHtml(
			<li class="piui-roster-row">
				<span safe>{String(row)}</span>
			</li>,
		);
	}
	const record = row;
	const label =
		textField(record.name) ??
		textField(record.title) ??
		textField(record.label) ??
		textField(record.id) ??
		"—";
	const state = textField(record.state) ?? textField(record.status);
	const detail = textField(record.detail);
	const rowId = textField(record.id) ?? textField(record.key);
	// Per-row actions (e.g. subagents.ts's roster `kill`/`select`) reply with the row id,
	// which `lib/bridge.ts` handlers read back as `value.id`.
	const actions = rowId === undefined ? [] : parseActions(record.actions);
	return syncHtml(
		<li class="piui-roster-row" data-piui-roster-state={state}>
			<span class="piui-roster-main">
				<span class="piui-roster-label" safe>
					{label}
				</span>
				{detail && (
					<span class="piui-roster-detail" safe>
						{detail}
					</span>
				)}
			</span>
			{state && (
				<span class="piui-roster-state" safe>
					{state}
				</span>
			)}
			{actions.length > 0 && (
				<span class="piui-actions piui-roster-actions">
					{actions.map((action) =>
						renderActionButton(
							element,
							action,
							JSON.stringify({ id: rowId }),
							"xs",
						),
					)}
				</span>
			)}
		</li>,
	);
}

function renderMarkdownBody(element: PiUiElement): string {
	const text = textField(element.data.text) ?? "";
	if (!text) return "";
	return syncHtml(
		<div class="piui-markdown markdown-content">
			{renderMarkdownStreaming(text, {
				cacheKey: `piui:${element.ns}:${element.id}`,
			})}
		</div>,
	);
}

function renderDiffBody(element: PiUiElement): string {
	const diffText =
		textField(element.data.unifiedDiff) ?? textField(element.data.diff) ?? "";
	if (!diffText) return "";
	// A dedicated syntax-highlighted diff view belongs to whichever consumer
	// (this widget area, or R1-C's Live Workspace) wants to invest in it; a
	// `<pre>` keeps this correct and dependency-free in the meantime.
	return syncHtml(
		<pre class="piui-diff" safe>
			{diffText}
		</pre>,
	);
}

type PiUiFieldSpec = {
	id: string;
	kind: string;
	label?: string;
	placeholder?: string;
	options: Array<{ id: string; label: string }>;
};

function renderPanelBody(element: PiUiElement): string {
	const sections = arrayFieldOf(element.data.sections);
	const fields = normalizeFields(element.data.fields);
	if (!sections && fields.length === 0) return renderGenericData(element.data);
	const topLevelFieldIds = new Set(fields.map((field) => field.id));
	return syncHtml(
		<div class="piui-panel">
			{sections?.map((section) =>
				renderPanelSection(element, section, topLevelFieldIds),
			)}
			{fields.length > 0 && renderFields(element, fields)}
		</div>,
	);
}

function renderPanelSection(
	element: PiUiElement,
	section: JsonValue,
	topLevelFieldIds: ReadonlySet<string>,
): string {
	if (!isJsonObject(section)) return "";
	const record = section;
	const kind = textField(record.kind);
	const text = textField(record.text) ?? "";
	if (kind === "form") {
		// A nested form section (e.g. btw.ts's composer) carries its own fields and actions.
		// Fields also declared top-level (ask-user.ts sends both) render once, from there.
		const sectionFields = normalizeFields(record.fields).filter(
			(field) => !topLevelFieldIds.has(field.id),
		);
		const sectionActions = parseActions(record.actions);
		if (sectionFields.length === 0 && sectionActions.length === 0) return "";
		return syncHtml(
			<div class="piui-panel-section piui-panel-form">
				{sectionFields.length > 0 && renderFields(element, sectionFields)}
				{sectionActions.length > 0 && (
					<div class="piui-actions">
						{sectionActions.map((action) =>
							renderActionButton(
								element,
								action,
								fieldValuesExpression(element, sectionFields),
							),
						)}
					</div>
				)}
			</div>,
		);
	}
	if (kind === "markdown") {
		return syncHtml(
			<div class="piui-panel-section piui-panel-markdown markdown-content">
				{renderMarkdownStreaming(text)}
			</div>,
		);
	}
	if (kind === "log") {
		return syncHtml(
			<div class="piui-panel-section piui-panel-log" safe>
				{text}
			</div>,
		);
	}
	return syncHtml(
		<div class="piui-panel-section piui-panel-status" safe>
			{text}
		</div>,
	);
}

function normalizeFields(value: JsonValue | undefined): PiUiFieldSpec[] {
	if (!Array.isArray(value)) return [];
	const fields: PiUiFieldSpec[] = [];
	for (const [index, raw] of value.entries()) {
		if (!isJsonObject(raw)) continue;
		const record = raw;
		const kind = textField(record.kind) ?? "text";
		const id = textField(record.id) ?? `field-${index}`;
		const options: Array<{ id: string; label: string }> = [];
		if (Array.isArray(record.options)) {
			for (const option of record.options) {
				if (!isJsonObject(option)) continue;
				const optionRecord = option;
				options.push({
					id: textField(optionRecord.id) ?? textField(optionRecord.value) ?? "",
					label:
						textField(optionRecord.label) ??
						textField(optionRecord.title) ??
						textField(optionRecord.id) ??
						"",
				});
			}
		}
		fields.push({
			id,
			kind,
			label: textField(record.label) ?? textField(record.title),
			placeholder: textField(record.placeholder),
			options,
		});
	}
	return fields;
}

function renderFields(element: PiUiElement, fields: PiUiFieldSpec[]): string {
	return syncHtml(
		<div class="piui-fields">
			{fields.map((field) => renderField(element, field))}
		</div>,
	);
}

function renderField(element: PiUiElement, field: PiUiFieldSpec): string {
	const signal = fieldSignal(element, field);
	if (field.kind === "textarea") {
		return syncHtml(
			<div class="field">
				{field.label && <label safe>{field.label}</label>}
				<textarea
					class="dialog-editor"
					placeholder={field.placeholder}
					data-signals={`{${signal}: ''}`}
					data-bind={signal}
				/>
			</div>,
		);
	}
	if (field.kind === "select") {
		return syncHtml(
			<div class="field">
				{field.label && <label safe>{field.label}</label>}
				<select data-signals={`{${signal}: ''}`} data-bind={signal}>
					{field.options.map((option) => (
						<option value={option.id} safe>
							{option.label}
						</option>
					))}
				</select>
			</div>,
		);
	}
	if (field.kind === "multiselect") {
		return syncHtml(
			<fieldset class="field piui-multiselect">
				{field.label && <legend safe>{field.label}</legend>}
				<div data-signals={`{${signal}: []}`}>
					{field.options.map((option) => (
						<label class="piui-multiselect-option">
							<input
								type="checkbox"
								data-on:change={`$${signal} = evt.target.checked ? [...$${signal}, ${JSON.stringify(option.id)}] : $${signal}.filter((value) => value !== ${JSON.stringify(option.id)})`}
							/>
							<span safe>{option.label}</span>
						</label>
					))}
				</div>
			</fieldset>,
		);
	}
	return syncHtml(
		<div class="field">
			{field.label && <label safe>{field.label}</label>}
			<input
				type="text"
				placeholder={field.placeholder}
				data-signals={`{${signal}: ''}`}
				data-bind={signal}
				autocomplete="off"
			/>
		</div>,
	);
}

function renderPiUiActions(element: PiUiElement): string {
	const fields = normalizeFields(element.data.fields);
	const declared = element.actions ?? [];
	// Bridge forms such as ask-user.ts's sheet send `fields` without any `actions` and wait
	// for a `submit` action carrying the field values; give them the button that sends it.
	const actions: readonly PiUiAction[] =
		fields.length > 0 && !declared.some((action) => action.id === submitActionId)
			? [{ id: submitActionId, label: "Submit", variant: "primary" }, ...declared]
			: declared;
	if (actions.length === 0) return "";
	return syncHtml(
		<div class="piui-actions">
			{actions.map((action) =>
				renderActionButton(
					element,
					action,
					fieldValuesExpression(element, fields),
				),
			)}
		</div>,
	);
}

function renderActionButton(
	element: PiUiElement,
	action: PiUiAction,
	valueExpression: string,
	size?: "xs",
): string {
	const post = actionPost(element, action.id, valueExpression);
	return syncHtml(
		<button
			type="button"
			class="btn"
			data-variant={
				action.variant === "primary"
					? undefined
					: action.variant === "danger"
						? "destructive"
						: "outline"
			}
			data-size={size}
			data-on:click={
				action.confirm
					? `if (confirm(${JSON.stringify(action.confirm)})) { ${post} }`
					: post
			}
			safe
		>
			{action.label}
		</button>,
	);
}

function renderGenericData(data: Readonly<Record<string, JsonValue>>): string {
	const entries = Object.entries(data).filter(([key]) => key !== "text");
	if (entries.length === 0) return "";
	return syncHtml(
		<dl class="piui-generic-data">
			{entries.map(([key, value]) => (
				<>
					<dt safe>{key}</dt>
					<dd safe>{summarize(value)}</dd>
				</>
			))}
		</dl>,
	);
}

function domId(element: PiUiElement): string {
	return `${element.ns}:${element.id}`;
}

function dialogId(element: PiUiElement): string {
	return piUiDialogId(element);
}

/**
 * The Datastar signal name holding a field's value. Only identifier characters are kept:
 * `piUiSlug` allows `-`, which Datastar expressions would parse as subtraction.
 */
function fieldSignal(element: PiUiElement, field: PiUiFieldSpec): string {
	return `_piuiField_${signalPart(element.ns)}_${signalPart(element.id)}_${signalPart(field.id)}`;
}

function signalPart(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Closing the sheet (Esc, backdrop, the Close button) replies with the `close` action id,
 * which `lib/bridge.ts` consumers (ask-user.ts, btw.ts) listen on to cancel or tear down.
 * It also remembers, in this browser only, that the element's current open generation was
 * dismissed — see `piUiDismissedStorageKey` (its reader is `UiRenderer.piUiSheetReopenScript`
 * in ui-renderer.ts) — so a `durable` sheet the extension never removes stays closed across a
 * reload/reconnect instead of popping back open (round-2 audit A#16). Keying on
 * `openGeneration` rather than `revision` means a streaming sheet's own `patch`/`append`
 * updates (which bump `revision` but not `openGeneration`) don't undo the dismissal (M4b).
 */
function dismissAction(element: PiUiElement): string {
	return `try {
		localStorage.setItem(${JSON.stringify(piUiDismissedStorageKey(element))}, ${JSON.stringify(String(element.openGeneration))});
	} catch {}
	${actionPost(element, closeActionId, "undefined")}`;
}

/** Shown in place of an empty body — a `panel`/`form` sheet with no fields or sections yet
 * (still loading, or the extension genuinely sent nothing) — so the sheet never opens onto
 * silent blank space (round-2 audit's "empty/loading … states for sheets"). */
function renderPiUiSheetEmptyState(): string {
	return syncHtml(<p class="fine-print piui-sheet-empty">Waiting for content…</p>);
}

/**
 * Native `<dialog>.showModal()` only autofocuses a descendant carrying the `autofocus`
 * attribute, which none of this module's field/action renderers set (they're shared with the
 * non-modal widget area, where autofocus would be wrong). Focus the first field, or else the
 * first action button, once per mount so a keyboard/screen-reader user lands somewhere useful
 * instead of on the dialog's own chrome (round-2 audit's "focus states for sheets").
 */
function sheetOpenFocusScript(): string {
	return `el.addEventListener('toggle', (evt) => {
		if (evt.newState !== 'open') return;
		requestAnimationFrame(() => {
			const target = el.querySelector('input:not([type=checkbox]), textarea, select, .piui-actions .btn');
			target?.focus();
		});
	});`;
}

function fieldValuesExpression(
	element: PiUiElement,
	fields: readonly PiUiFieldSpec[],
): string {
	return fields.length > 0
		? `{ ${fields.map((field) => `${JSON.stringify(field.id)}: $${fieldSignal(element, field)}`).join(", ")} }`
		: "undefined";
}

function parseActions(value: JsonValue | undefined): PiUiAction[] {
	if (!Array.isArray(value)) return [];
	const actions: PiUiAction[] = [];
	for (const candidate of value) {
		if (!isJsonObject(candidate)) continue;
		const id = textField(candidate.id);
		const label = textField(candidate.label);
		if (id === undefined || label === undefined) continue;
		const variant = candidate.variant;
		actions.push({
			id,
			label,
			variant:
				variant === "primary" || variant === "secondary" || variant === "danger"
					? variant
					: undefined,
			confirm: textField(candidate.confirm),
		});
	}
	return actions;
}

function actionPost(
	element: PiUiElement,
	actionId: string,
	valueExpression: string,
): string {
	// `elementId`/`actionId` match the `PiUiActionRequest` contract exactly —
	// this is what `lib/bridge.ts`'s `pi_ui_event` handler expects to decode.
	// It derives the namespace as `elementId.split(":")[0]`, so `elementId`
	// must carry `ns` itself (a bare `element.id` left the namespace-scoped
	// `piui:<ns>` event and its handlers unreachable — see r1-audit #22).
	return `@post('${endpoints.extensionUiAction}', { payload: {
		elementId: ${JSON.stringify(`${element.ns}:${element.id}`)},
		actionId: ${JSON.stringify(actionId)},
		value: ${valueExpression},
	} })`;
}

function textField(value: JsonValue | undefined): string | undefined {
	return isString(value) ? value : undefined;
}

function numberField(value: JsonValue | undefined): number | undefined {
	return isNumber(value) ? value : undefined;
}

function stringArray(value: JsonValue | undefined): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (isString(entry) ? entry : summarize(entry)));
}

function arrayFieldOf(value: JsonValue | undefined): JsonValue[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

/** Finds the first array-valued field on an element's data — used as a
 * best-effort fallback when a `roster` doesn't use the conventional
 * `rows`/`entries` field name. */
function arrayField(data: JsonObject): JsonValue[] | undefined {
	if (Array.isArray(data.rows)) return data.rows;
	if (Array.isArray(data.entries)) return data.entries;
	if (Array.isArray(data.items)) return data.items;
	for (const value of Object.values(data)) {
		if (Array.isArray(value)) return value;
	}
	return undefined;
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function summarize(value: JsonValue): string {
	if (isString(value)) return value;
	if (isNumber(value) || isBoolean(value)) return String(value);
	if (value === null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return "";
	}
}
