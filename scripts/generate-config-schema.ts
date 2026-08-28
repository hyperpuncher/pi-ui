import Type from "typebox";

import { defaultAutoTitleConfig } from "../src/agent/auto-title.ts";
import { codeThemesFor, defaultCodeThemes } from "../src/code-themes.ts";
import { appConfigSchemaUrl } from "../src/config-schema.ts";
import { defaultFonts, FONT_OPTIONS } from "../src/fonts.ts";
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
} from "../src/workspace-review-types.ts";

const codeThemes = defaultCodeThemes();
const fonts = defaultFonts();

const schema = Type.Object(
	{
		$schema: Type.Optional(
			Type.String({
				format: "uri",
				description: "JSON Schema used to validate this file.",
			}),
		),
		autoTitle: Type.Optional(
			Type.Object(
				{
					enabled: Type.Optional(
						Type.Boolean({
							default: defaultAutoTitleConfig.enabled,
							description: "Generate a title after the first user message.",
						}),
					),
					models: Type.Optional(
						Type.Array(
							Type.String({
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
					prompt: Type.Optional(
						Type.String({
							default: defaultAutoTitleConfig.prompt,
							description: "Additional title style instructions.",
						}),
					),
				},
				{
					description: "Automatic session title generation.",
					additionalProperties: false,
				},
			),
		),
		codeTheme: Type.Optional(
			Type.Object(
				{
					dark: Type.String({
						enum: codeThemesFor("dark").map((theme) => theme.name),
						default: codeThemes.dark,
					}),
					light: Type.String({
						enum: codeThemesFor("light").map((theme) => theme.name),
						default: codeThemes.light,
					}),
				},
				{
					description: "Code themes selected for each appearance.",
					additionalProperties: false,
				},
			),
		),
		fonts: Type.Optional(
			Type.Object(
				{
					mono: Type.String({
						enum: FONT_OPTIONS.mono,
						default: fonts.mono,
					}),
					sans: Type.String({
						enum: FONT_OPTIONS.sans,
						default: fonts.sans,
					}),
				},
				{
					description: "Fonts used for interface text and code.",
					additionalProperties: false,
				},
			),
		),
		gitView: Type.Optional(
			Type.Object(
				{
					changesRatio: Type.Optional(
						Type.Number({
							minimum: changesRatioMin,
							maximum: changesRatioMax,
							default: changesRatioDefault,
						}),
					),
					gitPaneRatio: Type.Optional(
						Type.Number({
							minimum: gitPaneRatioMin,
							maximum: gitPaneRatioMax,
							default: gitPaneRatioDefault,
						}),
					),
					layout: Type.Optional(
						Type.Union([Type.Literal("split"), Type.Literal("unified")]),
					),
					mode: Type.Optional(
						Type.Union([Type.Literal("all"), Type.Literal("selected")]),
					),
					reviewSidebarWidth: Type.Optional(
						Type.Number({
							minimum: reviewSidebarWidthMin,
							maximum: reviewSidebarWidthMax,
							default: reviewSidebarWidthDefault,
						}),
					),
					tab: Type.Optional(
						Type.Union([Type.Literal("files"), Type.Literal("git")]),
					),
					wrap: Type.Optional(Type.Boolean()),
				},
				{
					description: "Workspace panel preferences.",
					additionalProperties: false,
				},
			),
		),
		keybindHints: Type.Optional(
			Type.Boolean({
				default: true,
				description: "Show keyboard shortcut hints in the interface.",
			}),
		),
		minimalMode: Type.Optional(
			Type.Boolean({
				default: false,
				description: "Hide thinking details, keybind hints, and tool output.",
			}),
		),
		toolOutputHidden: Type.Optional(
			Type.Boolean({
				default: false,
				description: "Hide tool output and show compact one-line tool calls.",
			}),
		),
	},
	{
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: appConfigSchemaUrl,
		title: "pi-ui configuration",
		description: "Configuration for pi-ui.",
		additionalProperties: true,
	},
);

const output = `${JSON.stringify(schema, null, "\t")}\n`;
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
