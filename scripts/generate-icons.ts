import { icons } from "@iconify-json/lucide";

const names = [
	"arrow-down",
	"arrow-up",
	"brain",
	"check",
	"chevron-down",
	"chevron-left",
	"chevron-right",
	"command",
	"copy",
	"file-diff",
	"file-up",
	"folder",
	"folder-open",
	"git-branch",
	"message-circle-dashed",
	"message-circle-plus",
	"monitor",
	"moon",
	"panel-right",
	"paperclip",
	"rotate-ccw",
	"search",
	"square",
	"square-split-horizontal",
	"square-split-vertical",
	"star",
	"sun",
	"text-wrap",
	"trash",
	"x",
] as const satisfies readonly (keyof typeof icons.icons)[];

const selected = Object.fromEntries(
	names.map((name) => [
		name,
		icons.icons[name].body
			.replaceAll('fill="none"', 'fill="inherit"')
			.replaceAll('stroke-width="2"', 'stroke-width="inherit"'),
	]),
);
await Bun.write(
	new URL("../src/ui/icons.json", import.meta.url),
	`${JSON.stringify(selected, null, "\t")}\n`,
);
