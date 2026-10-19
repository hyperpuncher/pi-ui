import type { RouteMap } from "#src/server/route.ts";
import { assetRoutes } from "#src/server/routes/assets.ts";
import { authRoutes } from "#src/server/routes/auth.ts";
import { codeThemeRoutes } from "#src/server/routes/code-theme.ts";
import type { RouteContext } from "#src/server/routes/context.ts";
import { displayPreferenceRoutes } from "#src/server/routes/display-preferences.ts";
import { extensionUiRoutes } from "#src/server/routes/extension-ui.ts";
import { fileRoutes } from "#src/server/routes/files.ts";
import { fontRoutes } from "#src/server/routes/fonts.ts";
import { llamaRoutes } from "#src/server/routes/llama.ts";
import { modelRoutes } from "#src/server/routes/models.ts";
import { promptRoutes } from "#src/server/routes/prompt.ts";
import { sessionPerformanceRoutes } from "#src/server/routes/session-performance.ts";
import { sessionSidebarRoutes } from "#src/server/routes/session-sidebar.ts";
import { sessionRoutes } from "#src/server/routes/sessions.ts";
import { streamRoutes } from "#src/server/routes/stream.ts";
import { themeRoutes } from "#src/server/routes/theme.ts";
import { treeRoutes } from "#src/server/routes/tree.ts";
import { workspaceReviewRoutes } from "#src/server/routes/workspace-review.ts";
import { workspaceRoutes } from "#src/server/routes/workspace.ts";

export const appRoutes: RouteMap<RouteContext> = {
	...assetRoutes,
	...streamRoutes,
	...extensionUiRoutes,
	...themeRoutes,
	...codeThemeRoutes,
	...fontRoutes,
	...promptRoutes,
	...sessionRoutes,
	...sessionPerformanceRoutes,
	...sessionSidebarRoutes,
	...workspaceRoutes,
	...workspaceReviewRoutes,
	...displayPreferenceRoutes,
	...modelRoutes,
	...authRoutes,
	...llamaRoutes,
	...treeRoutes,
	...fileRoutes,
};
