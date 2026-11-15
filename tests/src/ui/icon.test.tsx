import { test } from "bun:test";

import { Icon } from "#src/ui/icon.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";
import { assertStringIncludes } from "#testing/assertions";

test("named icons render their SVG instead of escaped markup", () => {
	const html = syncHtml(<Icon name="search" />);
	assertStringIncludes(html, "<svg");
	assertStringIncludes(html, 'aria-hidden="true"');
});

test("labeled and custom icons retain their accessibility and shape", () => {
	const labeled = syncHtml(<Icon name="search" label="Search" />);
	assertStringIncludes(labeled, 'aria-label="Search"');
	assertStringIncludes(labeled, 'role="img"');
	const custom = syncHtml(
		<Icon>
			<circle cx="12" cy="12" r="4" />
		</Icon>,
	);
	assertStringIncludes(custom, "<circle");
});
