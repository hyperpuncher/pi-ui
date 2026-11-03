import { arr, bool, num, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

import { defaultAutoTitleConfig } from "#src/agent/auto-title.ts";
import { codeThemesFor, defaultCodeThemes } from "#src/code-themes.ts";
import { appConfigSchemaUrl } from "#src/config-schema.ts";
import { defaultFonts, FONT_OPTIONS } from "#src/fonts.ts";
import { keybindIds } from "#src/keybinds.ts";
import {
	sessionSidebarArchiveAfterDaysDefault,
	sessionSidebarArchiveAfterDaysMax,
	sessionSidebarArchiveAfterDaysMin,
	sessionSidebarWidthDefault,
	sessionSidebarWidthMax,
	sessionSidebarWidthMin,
} from "#src/session-sidebar-types.ts";
import {
	changesRatioDefault,
	changesRatioMax,
	changesRatioMin,
	gitPaneRatioDefault,
	gitPaneRatioMax,
	gitPaneRatioMin,
	reviewSidebarWidthDefault,
	reviewSidebarWidthMax,
	reviewSidebarWidthMin,
} from "#src/workspace-review-types.ts";

const codeThemes = defaultCodeThemes();
const fonts = defaultFonts();

const schema = obj(
	{
		$schema: opt(
			str({
				format: "uri",
				description: "JSON Schema used to validate this file.",
			}),
		),
		autoTitle: opt(
			obj(
				{
					enabled: opt(
						bool({
							default: defaultAutoTitleConfig.enabled,
							description: "Generate a title after the first user message.",
						}),
					),
					models: opt(
						arr(
							str({
								minLength: 1,
								description:
									"Model in provider/model:thinking-level format.",
							}),
							{
								default: [...defaultAutoTitleConfig.models],
								description: "Models to try in order.",
							},
						),
					),
					prompt: opt(
						str({
							default: defaultAutoTitleConfig.prompt,
							description: "Additional title style instructions.",
						}),
					),
				},
				{
					description: "Automatic session title generation.",
				},
			),
		),
		codeTheme: opt(
			obj(
				{
					dark: oneOf(
						codeThemesFor("dark").map((theme) => theme.name),
						{
							default: codeThemes.dark,
						},
					),
					light: oneOf(
						codeThemesFor("light").map((theme) => theme.name),
						{
							default: codeThemes.light,
						},
					),
				},
				{
					description: "Code themes selected for each appearance.",
				},
			),
		),
		fonts: opt(
			obj(
				{
					mono: oneOf<readonly string[]>(FONT_OPTIONS.mono, {
						default: fonts.mono,
					}),
					sans: oneOf<readonly string[]>(FONT_OPTIONS.sans, {
						default: fonts.sans,
					}),
				},
				{
					description: "Fonts used for interface text and code.",
				},
			),
		),
		gitView: opt(
			obj(
				{
					changesRatio: opt(
						num({
							minimum: changesRatioMin,
							maximum: changesRatioMax,
							default: changesRatioDefault,
						}),
					),
					gitPaneRatio: opt(
						num({
							minimum: gitPaneRatioMin,
							maximum: gitPaneRatioMax,
							default: gitPaneRatioDefault,
						}),
					),
					layout: opt(oneOf(["split", "unified"])),
					mode: opt(oneOf(["all", "selected"])),
					reviewSidebarWidth: opt(
						num({
							minimum: reviewSidebarWidthMin,
							maximum: reviewSidebarWidthMax,
							default: reviewSidebarWidthDefault,
						}),
					),
					tab: opt(oneOf(["files", "git"])),
					wrap: opt(bool()),
				},
				{
					description: "Workspace panel preferences.",
				},
			),
		),
		keybindHints: opt(
			bool({
				default: true,
				description: "Show keyboard shortcut hints in the interface.",
			}),
		),
		keybinds: opt(
			obj(
				Object.fromEntries(
					keybindIds().map((id) => [
						id,
						opt(str({ pattern: "^[a-zA-Z0-9^/]+( [a-zA-Z0-9^/]+)*$" })),
					]),
				),
				{
					description:
						"Keyboard shortcut overrides by action id, for example ctrl O, ctrl alt O, or alt shift T.",
				},
			),
		),
		minimalMode: opt(
			bool({
				default: false,
				description: "Hide thinking details, keybind hints, and tool output.",
			}),
		),
		sessionSidebar: opt(
			obj(
				{
					open: opt(
						bool({
							default: true,
							description:
								"Open the session sidebar on desktop (mobile always starts closed).",
						}),
					),
					width: opt(
						num({
							minimum: sessionSidebarWidthMin,
							maximum: sessionSidebarWidthMax,
							default: sessionSidebarWidthDefault,
							description: "Session sidebar width in pixels on desktop.",
						}),
					),
					archive: opt(
						bool({
							default: true,
							description:
								"Group sessions older than the archive threshold into a collapsed Archive section.",
						}),
					),
					archiveAfterDays: opt(
						num({
							minimum: sessionSidebarArchiveAfterDaysMin,
							maximum: sessionSidebarArchiveAfterDaysMax,
							default: sessionSidebarArchiveAfterDaysDefault,
							description:
								"Number of days of sessions to keep visible before archiving them.",
						}),
					),
				},
				{
					description: "Session sidebar preferences.",
				},
			),
		),
		theme: opt(
			oneOf(["system", "light", "dark"], {
				default: "system",
				description:
					"Interface appearance. System follows the operating system color scheme.",
			}),
		),
		toolOutputHidden: opt(
			bool({
				default: false,
				description: "Hide tool output and show compact one-line tool calls.",
			}),
		),
		toolbarHidden: opt(
			bool({
				default: false,
				description: "Hide the toolbar.",
			}),
		),
		updateCheck: opt(
			bool({
				default: true,
				description: "Check for a newer pi-ui release and show an update notice.",
			}),
		),
	},
	{
		title: "pi-ui configuration",
		description: "Configuration for pi-ui.",
		open: true,
	},
);

const output = `${JSON.stringify(
	{
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: appConfigSchemaUrl,
		...schema,
	},
	null,
	"\t",
)}\n`;
const outputUrl = new URL("../config.schema.json", import.meta.url);

if (process.argv.includes("--check")) {
	const current = await Bun.file(outputUrl)
		.text()
		.catch(() => "");
	if (current !== output) {
		throw new Error("config.schema.json is stale; run `bun run schema:build`");
	}
} else {
	await Bun.write(outputUrl, output);
}
