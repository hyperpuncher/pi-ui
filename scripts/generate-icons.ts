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
	"loader",
	"message-circle-dashed",
	"message-circle-plus",
	"panel-right",
	"paperclip",
	"rotate-ccw",
	"search",
	"square",
	"square-split-horizontal",
	"square-split-vertical",
	"star",
	"text-wrap",
	"trash",
	"x",
] as const satisfies readonly (keyof typeof icons.icons)[];

const selected = Object.fromEntries(names.map((name) => [name, icons.icons[name].body]));
await Bun.write(
	new URL("../src/ui/icons.json", import.meta.url),
	`${JSON.stringify(selected, null, "\t")}\n`,
);
