import { test } from "bun:test";

import { Icon } from "#src/ui/icon.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";
import { assertStringIncludes } from "#testing/assertions";

test("named icons render their SVG instead of escaped markup", () => {
	const html = syncHtml(<Icon name="search" />);
	assertStringIncludes(html, '<circle cx="11" cy="11" r="8"/>');
	assertStringIncludes(html, 'aria-hidden="true"');
});

test("labeled and custom icons retain their accessibility and shape", () => {
	const labeled = syncHtml(<Icon name="loader" label="Loading" role="status" />);
	assertStringIncludes(labeled, 'aria-label="Loading"');
	assertStringIncludes(labeled, 'role="status"');
	const custom = syncHtml(
		<Icon>
			<circle cx="12" cy="12" r="4" />
		</Icon>,
	);
	assertStringIncludes(custom, '<circle cx="12" cy="12" r="4"');
});
