import type { RouteMap } from "./route.ts";
import { assetRoutes } from "./routes/assets.ts";
import { authRoutes } from "./routes/auth.ts";
import { codeThemeRoutes } from "./routes/code-theme.ts";
import type { RouteContext } from "./routes/context.ts";
import { displayPreferenceRoutes } from "./routes/display-preferences.ts";
import { displayRefreshRoutes } from "./routes/display-refresh.ts";
import { extensionUiRoutes } from "./routes/extension-ui.ts";
import { fileRoutes } from "./routes/files.ts";
import { fontRoutes } from "./routes/fonts.ts";
import { llamaRoutes } from "./routes/llama.ts";
import { modelRoutes } from "./routes/models.ts";
import { promptRoutes } from "./routes/prompt.ts";
import { sessionPerformanceRoutes } from "./routes/session-performance.ts";
import { sessionSidebarRoutes } from "./routes/session-sidebar.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { streamRoutes } from "./routes/stream.ts";
import { treeRoutes } from "./routes/tree.ts";
import { workspaceReviewRoutes } from "./routes/workspace-review.ts";
import { workspaceRoutes } from "./routes/workspace.ts";

export const appRoutes: RouteMap<RouteContext> = {
	...assetRoutes,
	...streamRoutes,
	...displayRefreshRoutes,
	...extensionUiRoutes,
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
