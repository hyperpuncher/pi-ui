const sourcePath = new URL(import.meta.resolve("basecoat-css/styles/nova"));
const outputPath = new URL("../src/ui/basecoat.generated.css", import.meta.url);
const components = [
	["Badge", "badge"],
	["Button", "button"],
	["Command", "command"],
	["Dialog", "dialog"],
	["Dropdown Menu", "dropdown-menu"],
	["Field", "field"],
	["Input", "input"],
	["Input Group", "input-group"],
	["Kbd", "kbd"],
	["Popover", "popover"],
	["Table", "table"],
	["Textarea", "textarea"],
	["Tooltip", "tooltip"],
] as const;
const selectedSections = new Set(components.map(([section]) => section));
const source = await Deno.readTextFile(sourcePath);
const sectionPattern = /^\s*\/\* ([^*]+) \*\/\s*$/gm;
const sections = [...source.matchAll(sectionPattern)];
const availableSections = new Set(sections.map((section) => section[1]));

for (const section of selectedSections) {
	if (!availableSections.has(section)) {
		throw new Error(`Basecoat Nova section not found: ${section}`);
	}
}

const imports = [
	'@import "basecoat-css/base/base.css";',
	...components.map(
		([, component]) => `@import "basecoat-css/components/${component}.css";`,
	),
].join("\n");
const selectedCss = sections
	.filter((section) => selectedSections.has(section[1]))
	.map((section) => {
		const sourceIndex = sections.indexOf(section);
		const start = (section.index ?? 0) + section[0].length;
		const nextSection = sections[sourceIndex + 1];
		const end = nextSection?.index ?? source.lastIndexOf("}");
		return `  /* ${section[1]} */${source.slice(start, end)}`;
	})
	.join("\n");

await Deno.writeTextFile(
	outputPath,
	`${imports}\n\n/* Generated from the used Basecoat Nova component sections. */\n@layer components {${selectedCss}\n}\n`,
);
